/**
 * LIMITE DE DADOS DA IA COM O HÓSPEDE (17/10/2026, decisão do anfitrião): a IA só fala de dados a
 * que o hóspede tem acesso. Exemplo: valor BRUTO da reserva, nunca valores líquidos. Vale para
 * todos os canais (Airbnb, guia, WhatsApp).
 */
export const GUEST_DATA_BOUNDARY = `

DADOS QUE A IA PODE CITAR (obrigatório)
- Fale apenas de dados a que o hóspede tem acesso: o que ele vê na própria reserva e no anúncio (datas, horários, ocupantes, valor TOTAL BRUTO da reserva, política de cancelamento da reserva, regras da casa, instruções do guia).
- PROIBIDO citar ou insinuar: valor líquido, comissão ou taxa do anfitrião, repasse ou pagamento ao anfitrião/co-anfitrião, quem é co-anfitrião, custos, valores de limpeza pagos a prestadores, margens e qualquer número financeiro interno.
- Pediu algo financeiro interno ("quanto o anfitrião recebe?", "qual a comissão?"): diga com gentileza que não tem acesso a essa informação e, se ele insistir, siga a regra de dinheiro/contrato.`;
