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

interface MagicLinkEmailProps {
  siteName?: string
  siteUrl?: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteUrl = 'https://guia.anfitriaosigma.com.br',
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Seu link de acesso ao ConciergeIA</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={card}>
          <Text style={brand}>ConciergeIA</Text>
          <Heading style={h1}>Seu link de acesso</Heading>
          <Text style={text}>
            Clique no botão abaixo para entrar na plataforma. Por segurança,
            o link expira em pouco tempo.
          </Text>
          <Section style={{ margin: '28px 0' }}>
            <Button style={button} href={confirmationUrl}>
              Entrar agora
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            Se você não pediu este link, é só ignorar este e-mail.
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

export default MagicLinkEmail

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
const hr = { borderColor: '#efe7e1', margin: '26px 0 18px' }
const link = { color: '#c2683f', textDecoration: 'none' }
const footer = {
  fontSize: '12px',
  lineHeight: '1.6',
  color: '#9a8f88',
  margin: '0 0 6px',
}
