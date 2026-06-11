import villaHero from "@/assets/villa-hero.jpg";
import recRestaurant from "@/assets/rec-restaurant.jpg";
import recCafe from "@/assets/rec-cafe.jpg";
import recBeach from "@/assets/rec-beach.jpg";
import recMarket from "@/assets/rec-market.jpg";
import mapPreview from "@/assets/map-preview.jpg";

export const property = {
  name: "Casa da Falésia",
  tagline: "Praia do Sancho · Fernando de Noronha",
  heroImage: villaHero,
  mapImage: mapPreview,
  guest: { firstName: "Mariana" },
  reservation: {
    checkIn: "12 Mai",
    checkOut: "18 Mai",
    year: "2026",
    nights: 6,
  },
  checkIn: {
    time: "15:00",
    lockCode: "1289",
    gateCode: "9931",
    address: "Rua das Orquídeas, 450 — Praia do Sancho",
    mapsUrl:
      "https://www.google.com/maps/search/?api=1&query=Praia+do+Sancho+Fernando+de+Noronha",
    note: "A entrada fica escondida atrás de um muro de pedra natural. Estacionamento à esquerda da casa.",
  },
  checkOut: {
    time: "11:00",
    checklist: [
      { id: "trash", label: "Lixo retirado e colocado na lixeira externa" },
      { id: "dishes", label: "Louça lavada ou na lava-louças" },
      { id: "ac", label: "Ar-condicionado e ventiladores desligados" },
      { id: "windows", label: "Janelas e portas fechadas" },
      { id: "keys", label: "Chave devolvida no porta-chaves da entrada" },
    ],
  },
  wifi: {
    ssid: "CasaDaFalesia_Guest",
    password: "falesia-2026-vista",
  },
  manual: [
    {
      id: "kitchen",
      title: "Cozinha",
      desc: "Indução, cafeteira, lava-louças",
      body: "A cafeteira está sobre a bancada. Cápsulas no armário acima. Lava-louças no modo eco roda em 1h40.",
    },
    {
      id: "ac",
      title: "Ar-condicionado",
      desc: "Controle central no corredor",
      body: "Temperatura recomendada: 23°C. Modo silencioso à noite (botão lua).",
    },
    {
      id: "pool",
      title: "Piscina",
      desc: "Aberta das 7h às 22h",
      body: "Toalhas extras na cabana. Iluminação noturna ativa automaticamente ao anoitecer.",
    },
    {
      id: "bbq",
      title: "Churrasqueira",
      desc: "Carvão no armário lateral",
      body: "Acendedor elétrico ao lado. Por favor, limpe a grelha após o uso.",
    },
    {
      id: "tv",
      title: "TV & Streaming",
      desc: "Smart TV 55\" com Netflix",
      body: "Faça login com sua própria conta — fazemos logout no check-out por segurança.",
    },
    {
      id: "laundry",
      title: "Lavadora",
      desc: "Programa rápido: 30 min",
      body: "Sabão e amaciante na prateleira acima da máquina.",
    },
  ],
  recommendations: {
    restaurants: [
      {
        id: "pe-de-areia",
        name: "Pé de Areia",
        category: "Frutos do mar",
        rating: 4.9,
        distance: "0.4 km",
        image: recRestaurant,
        note: "Peixe na brasa com vista para o pôr do sol. Reserve com antecedência.",
        mapsUrl: "https://www.google.com/maps/search/?api=1&query=Pe+de+Areia+restaurante",
      },
      {
        id: "grao-cafe",
        name: "Grão & Café",
        category: "Café da manhã",
        rating: 4.8,
        distance: "1.2 km",
        image: recCafe,
        note: "Torrefação própria, pães artesanais e bowls de açaí.",
        mapsUrl: "https://www.google.com/maps/search/?api=1&query=Grao+e+Cafe",
      },
    ],
    markets: [
      {
        id: "mercado-vila",
        name: "Mercado da Vila",
        category: "Mercado",
        rating: 4.7,
        distance: "0.9 km",
        image: recMarket,
        note: "Orgânicos locais, vinhos e o melhor pão da ilha.",
        mapsUrl: "https://www.google.com/maps/search/?api=1&query=Mercado+da+Vila",
      },
    ],
    beaches: [
      {
        id: "sancho",
        name: "Praia do Sancho",
        category: "Praia & Natureza",
        rating: 5.0,
        distance: "5 min a pé",
        image: recBeach,
        note: "Melhor visita entre 9h e 11h, quando o sol entra na enseada.",
        mapsUrl: "https://www.google.com/maps/search/?api=1&query=Praia+do+Sancho",
      },
    ],
  },
  emergency: [
    { id: "police", label: "Polícia", number: "190" },
    { id: "fire", label: "Bombeiros", number: "193" },
    { id: "ambulance", label: "SAMU", number: "192" },
    { id: "host", label: "Anfitrião · Carlos", number: "+55 11 99999-0000" },
    { id: "pharmacy", label: "Farmácia 24h", number: "+55 81 3619-1234" },
  ],
  faq: [
    {
      q: "Qual a senha do Wi-Fi?",
      a: "Você encontra na aba Wi-Fi do app — basta tocar em copiar.",
    },
    {
      q: "Posso receber visitas?",
      a: "Sim, até 4 visitantes durante o dia. Pernoite extra precisa ser combinado com o anfitrião.",
    },
    {
      q: "Onde estacionar?",
      a: "Há uma vaga coberta à esquerda da casa. Carros extras na rua, em frente.",
    },
    {
      q: "Como funciona o check-out?",
      a: "Saída até 11h. Veja o checklist visual na aba Check-out.",
    },
    {
      q: "Tem suporte 24h?",
      a: "Sim, fale com o Carlos pelo botão na aba Emergência, ou pelo Chat IA a qualquer hora.",
    },
  ],
};

export type Property = typeof property;
export type Recommendation = Property["recommendations"]["restaurants"][number];
