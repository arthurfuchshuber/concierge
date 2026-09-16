import * as React from 'react'
import { render } from '@react-email/render'
import { TEMPLATES } from '@/lib/email-templates/registry'

function token32(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const SITE_NAME = 'ConciergeIA'
const SENDER_DOMAIN = 'notify.guia.anfitriaosigma.com.br'
const FROM_DOMAIN = 'guia.anfitriaosigma.com.br'

/**
 * Envia um e-mail transacional do app a partir do servidor (sem depender do
 * JWT do usuário): renderiza o template registrado e enfileira na pgmq.
 */
export async function sendAppEmail(opts: {
  templateName: string
  recipientEmail: string
  templateData?: Record<string, unknown>
  idempotencyKey?: string
}): Promise<{ ok: boolean; reason?: string }> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
  const template = TEMPLATES[opts.templateName]
  if (!template) throw new Error(`Template '${opts.templateName}' não encontrado.`)

  const recipient = (template.to || opts.recipientEmail || '').toLowerCase().trim()
  if (!recipient) throw new Error('Destinatário ausente.')

  const messageId = crypto.randomUUID()
  const data = opts.templateData ?? {}

  const { data: suppressed, error: suppressionError } = await supabaseAdmin
    .from('suppressed_emails')
    .select('id')
    .eq('email', recipient)
    .maybeSingle()
  if (suppressionError) throw new Error('Não foi possível verificar a lista de bloqueios.')
  if (suppressed) {
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: opts.templateName,
      recipient_email: recipient,
      status: 'suppressed',
    })
    return { ok: false, reason: 'email_suppressed' }
  }

  // Token de descadastro (um por endereço)
  let unsubscribeToken: string
  const { data: existing } = await supabaseAdmin
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', recipient)
    .maybeSingle()
  if (existing?.token) {
    unsubscribeToken = existing.token as string
  } else {
    unsubscribeToken = token32()
    await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .upsert({ token: unsubscribeToken, email: recipient }, { onConflict: 'email', ignoreDuplicates: true })
    const { data: stored } = await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', recipient)
      .maybeSingle()
    if (stored?.token) unsubscribeToken = stored.token as string
  }

  const element = React.createElement(template.component, data as never)
  const html = await render(element)
  const text = await render(element, { plainText: true })
  const subject =
    typeof template.subject === 'function'
      ? template.subject(data as Record<string, unknown>)
      : template.subject

  await supabaseAdmin.from('email_send_log').insert({
    message_id: messageId,
    template_name: opts.templateName,
    recipient_email: recipient,
    status: 'pending',
  })

  const { error: enqueueError } = await supabaseAdmin.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: recipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: 'transactional',
      label: opts.templateName,
      idempotency_key: opts.idempotencyKey ?? messageId,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  } as never)

  if (enqueueError) {
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: opts.templateName,
      recipient_email: recipient,
      status: 'failed',
      error_message: enqueueError.message,
    })
    throw new Error(`Falha ao enfileirar o e-mail: ${enqueueError.message}`)
  }

  return { ok: true }
}
