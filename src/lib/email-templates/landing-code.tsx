import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  name?: string
  code?: string
}

const Email = ({ name, code }: Props) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>{`Seu código do ConciergeIA: ${code ?? ''}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={heading}>{name ? `Olá, ${name}!` : 'Olá!'}</Heading>
        <Text style={text}>Use este código para confirmar seu e-mail e conversar com o ConciergeIA:</Text>
        <Text style={codeStyle}>{code}</Text>
        <Text style={small}>O código vale por 30 minutos. Se não foi você, ignore este e-mail.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'Seu código de confirmação — ConciergeIA',
  displayName: 'Código de confirmação (site)',
  previewData: { name: 'Marina', code: '123456' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const heading = { fontSize: '20px', color: '#111111', margin: '0 0 12px' }
const text = { fontSize: '14px', color: '#333333', margin: '0 0 16px' }
const codeStyle = { fontSize: '32px', letterSpacing: '8px', fontWeight: 700, color: '#111111', margin: '0 0 16px' }
const small = { fontSize: '12px', color: '#888888', margin: '0' }
