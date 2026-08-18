import * as React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

export interface AccountInviteProps {
  inviterName?: string | null
  accountName?: string | null
  recipientEmail?: string | null
  actionUrl?: string
  existingUser?: boolean
  expiresAt?: string | null
  siteUrl?: string
}

function formatDate(value?: string | null) {
  if (!value) return null
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(value))
  } catch {
    return null
  }
}

const AccountInviteEmail = ({
  inviterName,
  accountName,
  recipientEmail,
  actionUrl = 'https://guia.anfitriaosigma.com.br/painel',
  existingUser = false,
  expiresAt,
  siteUrl = 'https://guia.anfitriaosigma.com.br',
}: AccountInviteProps) => {
  const account = accountName || inviterName || 'uma equipe do ConciergeIA'
  const expires = formatDate(expiresAt)

  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{`${inviterName ? inviterName + ' convidou você' : 'Você foi convidado'} para a equipe ${account} no ConciergeIA`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <Text style={brand}>CONCIERGEIA</Text>
            <Heading style={h1}>
              {inviterName ? `${inviterName} convidou você` : 'Você foi convidado'}
            </Heading>
            <Text style={text}>
              Você recebeu um convite para acessar o painel da conta{' '}
              <strong style={strong}>{account}</strong> no ConciergeIA — a plataforma
              que organiza check-ins, check-outs, hóspedes e o atendimento
              inteligente das residências.
            </Text>

            <Section style={infoBox}>
              <Text style={infoRow}>
                <span style={infoLabel}>Conta</span>
                <br />
                <span style={infoValue}>{account}</span>
              </Text>
              {recipientEmail ? (
                <Text style={infoRow}>
                  <span style={infoLabel}>Seu acesso</span>
                  <br />
                  <span style={infoValue}>{recipientEmail}</span>
                </Text>
              ) : null}
              {expires ? (
                <Text style={{ ...infoRow, marginBottom: 0 }}>
                  <span style={infoLabel}>Válido até</span>
                  <br />
                  <span style={infoValue}>{expires}</span>
                </Text>
              ) : null}
            </Section>

            <Section style={{ margin: '26px 0 6px' }}>
              <Button style={button} href={actionUrl}>
                {existingUser ? 'Entrar e aceitar convite' : 'Criar minha senha e entrar'}
              </Button>
            </Section>
            <Text style={smallMuted}>
              Se o botão não funcionar, copie e cole este endereço no navegador:
              <br />
              <Link href={actionUrl} style={link}>
                {actionUrl}
              </Link>
            </Text>

            <Section style={steps}>
              <Text style={stepTitle}>Como funciona</Text>
              <Text style={step}>
                <strong style={strong}>1.</strong>{' '}
                {existingUser
                  ? 'Clique no botão acima para entrar com o seu acesso.'
                  : 'Clique no botão acima e defina a sua senha (leva menos de um minuto).'}
              </Text>
              <Text style={step}>
                <strong style={strong}>2.</strong> Na primeira tela do painel, aceite o
                convite da equipe.
              </Text>
              <Text style={step}>
                <strong style={strong}>3.</strong> Pronto: o titular libera as áreas que
                você pode ver ou editar.
              </Text>
            </Section>

            <Hr style={hr} />
            <Text style={footer}>
              Se você não esperava este convite, pode ignorar este e-mail com
              tranquilidade — nada acontece sem o seu aceite.
            </Text>
            <Text style={footer}>
              <Link href={siteUrl} style={link}>
                guia.anfitriaosigma.com.br
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AccountInviteEmail,
  subject: (data: Record<string, any>) =>
    data?.inviterName
      ? `${data.inviterName} convidou você para o ConciergeIA`
      : 'Você foi convidado para uma equipe no ConciergeIA',
  displayName: 'Convite de equipe',
  previewData: {
    inviterName: 'Anfitrião Sigma',
    accountName: 'Anfitrião Sigma',
    recipientEmail: 'pessoa@empresa.com',
    actionUrl: 'https://guia.anfitriaosigma.com.br/definir-senha',
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
  },
} satisfies TemplateEntry

export default AccountInviteEmail

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  padding: '24px 0',
}
const container = { maxWidth: '560px', margin: '0 auto', padding: '0 16px' }
const card = {
  border: '1px solid #efe7e1',
  borderRadius: '18px',
  padding: '32px 30px',
  backgroundColor: '#fffdfb',
}
const brand = {
  fontSize: '12px',
  letterSpacing: '2px',
  color: '#c2683f',
  fontWeight: 700 as const,
  margin: '0 0 14px',
}
const h1 = {
  fontSize: '26px',
  lineHeight: '1.25',
  fontWeight: 700 as const,
  color: '#241c16',
  margin: '0 0 16px',
}
const text = {
  fontSize: '15px',
  lineHeight: '1.65',
  color: '#5b524c',
  margin: '0 0 18px',
}
const strong = { color: '#241c16' }
const infoBox = {
  border: '1px solid #efe7e1',
  borderRadius: '14px',
  padding: '16px 18px',
  backgroundColor: '#ffffff',
}
const infoRow = { margin: '0 0 12px' }
const infoLabel = {
  fontSize: '11px',
  letterSpacing: '1px',
  color: '#9a8f88',
  textTransform: 'uppercase' as const,
}
const infoValue = { fontSize: '15px', color: '#241c16', fontWeight: 600 as const }
const button = {
  backgroundColor: '#c2683f',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600 as const,
  borderRadius: '12px',
  padding: '14px 26px',
  textDecoration: 'none',
  display: 'inline-block',
}
const smallMuted = {
  fontSize: '12px',
  lineHeight: '1.6',
  color: '#9a8f88',
  margin: '0 0 22px',
  wordBreak: 'break-all' as const,
}
const steps = {
  backgroundColor: '#faf5f1',
  borderRadius: '14px',
  padding: '18px 20px',
}
const stepTitle = {
  fontSize: '13px',
  fontWeight: 700 as const,
  color: '#241c16',
  margin: '0 0 10px',
}
const step = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#5b524c',
  margin: '0 0 6px',
}
const hr = { borderColor: '#efe7e1', margin: '26px 0 18px' }
const link = { color: '#c2683f', textDecoration: 'none' }
const footer = {
  fontSize: '12px',
  lineHeight: '1.6',
  color: '#9a8f88',
  margin: '0 0 6px',
}
