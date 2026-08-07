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

interface InviteEmailProps {
  siteName?: string
  siteUrl?: string
  recipient?: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteUrl = 'https://guia.anfitriaosigma.com.br',
  recipient,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Você foi convidado para acessar o ConciergeIA</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={card}>
          <Text style={brand}>ConciergeIA</Text>
          <Heading style={h1}>Seu acesso está pronto</Heading>
          <Text style={text}>
            Olá! Você foi convidado para fazer parte de uma equipe no
            ConciergeIA — a plataforma que organiza check-ins, check-outs e o
            atendimento aos hóspedes.
          </Text>
          <Text style={text}>
            Para começar, crie a sua senha de acesso. Leva menos de um minuto.
          </Text>
          <Section style={{ margin: '28px 0' }}>
            <Button style={button} href={confirmationUrl}>
              Criar minha senha
            </Button>
          </Section>

          <Section style={steps}>
            <Text style={stepTitle}>Como funciona</Text>
            <Text style={step}>1. Clique no botão acima e defina sua senha.</Text>
            <Text style={step}>
              2. Você entra no painel {recipient ? `com o e-mail ${recipient}` : 'com o seu e-mail'}.
            </Text>
            <Text style={step}>
              3. Aceite o convite da equipe que aparece na primeira tela.
            </Text>
          </Section>

          <Hr style={hr} />
          <Text style={footer}>
            O link expira em alguns dias por segurança. Se você não esperava
            este convite, pode ignorar este e-mail com tranquilidade.
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

export default InviteEmail

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
  textTransform: 'uppercase' as const,
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
  margin: '0 0 14px',
}
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
