import * as React from 'react'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

export interface AccessNoticeProps {
  kind?: 'created' | 'password_changed' | 'linked_existing' | 'removed'
  accountName?: string | null
  recipientEmail?: string | null
  provisionalPassword?: string | null
  actionUrl?: string
}

const TITLES: Record<string, string> = {
  created: 'Seu acesso ao ConciergeIA foi criado',
  password_changed: 'Sua senha provisória foi alterada',
  linked_existing: 'Você foi adicionado a uma nova empresa',
  removed: 'Seu acesso a uma empresa foi removido',
}

const AccessNoticeEmail = ({
  kind = 'created',
  accountName,
  recipientEmail,
  provisionalPassword,
  actionUrl = 'https://conciergeia.app/auth',
}: AccessNoticeProps) => {
  const account = accountName || 'uma empresa'
  const title = TITLES[kind] ?? TITLES.created
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{title}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <Text style={brand}>CONCIERGEIA</Text>
            <Heading style={h1}>{title}</Heading>
            <Text style={text}>
              {kind === 'created' && <>A empresa <strong>{account}</strong> liberou seu acesso ao painel.</>}
              {kind === 'password_changed' && <>A empresa <strong>{account}</strong> definiu uma nova senha provisória para você.</>}
              {kind === 'linked_existing' && <>A empresa <strong>{account}</strong> adicionou você à equipe. Entre com seu e-mail e a senha que você já usa no ConciergeIA e escolha a empresa no topo do painel.</>}
              {kind === 'removed' && <>A empresa <strong>{account}</strong> removeu seu acesso ao painel dela. Seus outros acessos continuam iguais.</>}
            </Text>
            {kind !== 'removed' && (
              <Section style={infoBox}>
                {recipientEmail ? <Text style={infoRow}><span style={label}>E-mail</span><br />{recipientEmail}</Text> : null}
                {provisionalPassword ? (
                  <Text style={infoRow}><span style={label}>Senha provisória</span><br /><span style={mono}>{provisionalPassword}</span></Text>
                ) : null}
              </Section>
            )}
            {provisionalPassword ? (
              <Text style={small}>No primeiro acesso, o sistema pedirá que você crie sua própria senha.</Text>
            ) : null}
            {kind !== 'removed' && (
              <Section style={{ margin: '22px 0 6px' }}>
                <Button style={button} href={actionUrl}>Entrar no ConciergeIA</Button>
              </Section>
            )}
            <Text style={small}>Se você não reconhece esta ação, responda a este e-mail ou fale com a empresa.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AccessNoticeEmail,
  subject: (d: Record<string, any>) => TITLES[d.kind as string] ?? TITLES.created,
  displayName: 'Aviso de acesso',
  previewData: { kind: 'created', accountName: 'Anfitrião Sigma', recipientEmail: 'prestador@exemplo.com', provisionalPassword: 'Ab3$kT9pQz' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 16px', maxWidth: '560px' }
const card = { border: '1px solid #ece8f5', borderRadius: '14px', padding: '28px' }
const brand = { fontSize: '11px', letterSpacing: '3px', color: '#7c5cd6', fontWeight: 700, margin: '0 0 12px' }
const h1 = { fontSize: '22px', color: '#1d1a26', margin: '0 0 14px' }
const text = { fontSize: '15px', lineHeight: '23px', color: '#3d3850' }
const infoBox = { backgroundColor: '#f7f5fc', borderRadius: '10px', padding: '14px 18px', margin: '18px 0' }
const infoRow = { fontSize: '14px', color: '#1d1a26', margin: '6px 0' }
const label = { fontSize: '11px', color: '#7a7390', textTransform: 'uppercase' as const, letterSpacing: '1px' }
const mono = { fontFamily: 'Courier, monospace', fontSize: '16px', fontWeight: 700 }
const button = { backgroundColor: '#7c5cd6', color: '#ffffff', borderRadius: '10px', padding: '12px 22px', fontSize: '15px', fontWeight: 700, textDecoration: 'none' }
const small = { fontSize: '12px', color: '#7a7390', lineHeight: '18px' }
