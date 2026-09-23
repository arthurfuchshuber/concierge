import React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  name?: string
  company?: string
  propertiesCount?: string
  whatsapp?: string
  email?: string
  challenge?: string
}

const Row = ({ label, value }: { label: string; value?: string }) =>
  value ? (
    <Text style={row}>
      <span style={rowLabel}>{label}:</span> {value}
    </Text>
  ) : null

const Email = ({ name, company, propertiesCount, whatsapp, email, challenge }: Props) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>{`Novo contato pelo site: ${name || 'sem nome'}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={heading}>Novo contato pelo site</Heading>
        <Text style={intro}>
          Alguém preencheu o formulário da página inicial do ConciergeIA.
        </Text>
        <Hr style={hr} />
        <Section>
          <Row label="Nome" value={name} />
          <Row label="Empresa / Operação" value={company} />
          <Row label="Quantidade de imóveis" value={propertiesCount} />
          <Row label="WhatsApp" value={whatsapp} />
          <Row label="E-mail" value={email} />
          <Row label="Principal desafio" value={challenge} />
        </Section>
        <Hr style={hr} />
        <Text style={footer}>ConciergeIA</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'Novo contato pelo site — ConciergeIA',
  displayName: 'Novo contato (site)',
  previewData: {
    name: 'Marina Souza',
    company: 'Souza Temporada',
    propertiesCount: '11 a 30',
    whatsapp: '(47) 99999-0000',
    email: 'marina@exemplo.com.br',
    challenge: 'Organização da operação',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const heading = { fontSize: '20px', color: '#111111', margin: '0 0 8px' }
const intro = { fontSize: '14px', color: '#555555', margin: '0' }
const hr = { borderColor: '#eeeeee', margin: '20px 0' }
const row = { fontSize: '14px', color: '#222222', margin: '0 0 8px' }
const rowLabel = { color: '#777777' }
const footer = { fontSize: '12px', color: '#999999', margin: '0' }
