import { sendTemplateEmail } from '@/lib/email-templates/send-email'

/**
 * Envia um e-mail transacional do app a partir do servidor (sem depender do
 * JWT do usuário): renderiza o template registrado e envia pela entrega
 * gerenciada do Lovable. Bloqueios (bounce/reclamação/descadastro) são
 * aplicados no lado do Lovable — não há fila nem lista local.
 */
export async function sendAppEmail(opts: {
  templateName: string
  recipientEmail: string
  templateData?: Record<string, unknown>
  idempotencyKey?: string
}): Promise<{ ok: boolean; reason?: string }> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
  const recipient = (opts.recipientEmail || '').toLowerCase().trim()

  async function log(status: string, errorMessage?: string) {
    const { error } = await supabaseAdmin.from('email_send_log').insert({
      message_id: null,
      template_name: opts.templateName,
      recipient_email: recipient,
      status,
      ...(errorMessage ? { error_message: errorMessage.slice(0, 1000) } : {}),
    })
    if (error) {
      console.error('[email] falha ao registrar envio', {
        code: error.code,
        message: error.message,
        status,
      })
    }
  }

  try {
    const result = await sendTemplateEmail(opts.templateName, recipient, {
      templateData: (opts.templateData ?? {}) as Record<string, any>,
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    })

    if (!result.sent) {
      await log('suppressed')
      return { ok: false, reason: 'email_suppressed' }
    }

    await log('sent')
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await log('failed', message)
    throw error
  }
}
