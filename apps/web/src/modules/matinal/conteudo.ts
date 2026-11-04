// Conteudo fixo do 1o ciclo da Matinal Elo Forte, copiado do Guia (repo matinal_eloforte, shared/conteudo.ts e shared/regras.ts).

export const ORACAO =
  'Deus, obrigado por mais uma semana de trabalho. Protege cada um de nós aqui e no caminho de casa. Dá sabedoria para fazer o certo, respeito para tratar bem colegas e clientes e cuidado para trabalhar com segurança. Amém.';

export const ROTEIRO = [
  {
    n: 1,
    faz: 'Reúna a equipe em roda. Convide para a oração. Ninguém é obrigado a rezar ou falar.',
    fala: '"Bom dia! Vamos começar com uma oração. Quem preferir pode acompanhar em silêncio."',
  },
  {
    n: 2,
    faz: 'Leia o combinado da última ata. Se ficou pendente, anote quem faz e o novo prazo. Na 1ª Matinal, explique para que serve o encontro.',
    fala: '"O que combinamos na última reunião foi feito? O que ajudou ou atrapalhou?"',
    falaPrimeira: '"Toda semana, vamos ter 15 minutos para falar do nosso jeito de trabalhar e combinar uma melhoria."',
  },
  {
    n: 3,
    faz: 'Diga o tema em uma frase. Explique o cuidado necessário. Dê um exemplo da rotina da equipe. Mostre no local, quando possível. Use a ficha do tema.',
    fala: 'Fala de abertura da ficha.',
  },
  {
    n: 4,
    faz: 'Ouça respostas curtas e agradeça. Assunto demorado fica para depois: anote na ata. Não exponha ninguém, não chame atenção em público e não trate de assunto pessoal.',
    fala: 'Pergunta da ficha. "O que podemos fazer hoje para melhorar?"',
  },
  {
    n: 5,
    faz: 'Comece com uma ação. No máximo três. Cada ação: o quê, quem, até quando. Leia em voz alta e confirme se o responsável entendeu.',
    fala: 'Ex.: "Tirar as caixas do corredor do depósito. Quem faz: Carlos. Até quando: hoje, às 10h. Carlos, ficou claro?"',
  },
  {
    n: 6,
    faz: 'Tire as dúvidas. Recolha as assinaturas e termine no horário. Equipe grande: folhas de presença ao mesmo tempo.',
    fala: '"Todos entenderam o que vamos fazer? Há alguma dúvida? Obrigado e bom trabalho!"',
  },
] as const;

export const CHECKLIST_VESPERA = [
  'Ler a ficha do tema da semana',
  'Confirmar quem vai anotar a ata',
  'Separar o combinado da última ata',
  'Conferir a lista da equipe',
];

export const LEMBRETES = [
  'Risco imediato se trata antes de iniciar a atividade, sem esperar a Matinal.',
  'A Matinal não substitui os treinamentos necessários.',
];



export interface TemaSeed {
  semana: number;
  mes: number;
  titulo: string;
  codigo_cultura: string;
  citacao: string;
  fala_abertura: string;
  exemplo: string;
  pergunta: string;
  combinado_sugerido: string;
}

export const TEMAS_CICLO_1: TemaSeed[] = [
  {
    semana: 1, mes: 1, titulo: 'Caminhos livres para evitar quedas',
    codigo_cultura: 'Atitude de dono', citacao: 'resolver um problema que vê, em vez de só reportar.',
    fala_abertura: 'Caixa, produto, fio ou mangueira no chão podem derrubar alguém. Viu algo no caminho? Tire, se for seguro. Se não puder resolver, avise o líder na hora, do jeito que a unidade orienta.',
    exemplo: 'Caixa esquecida no corredor do depósito, balde perto do caixa, mangueira solta na pista, fio atravessado na sala.',
    pergunta: 'Onde, no nosso setor, alguém pode tropeçar ou escorregar?',
    combinado_sugerido: 'Fazer uma ronda rápida no fim do turno para deixar as passagens livres.',
  },
  {
    semana: 2, mes: 1, titulo: 'Um elo sozinho não sustenta nada',
    codigo_cultura: 'Nossos valores e propósito', citacao: 'É assim que enxergamos nossas pessoas: elos de uma mesma corrente.',
    fala_abertura: 'Elo é aquilo que liga uma coisa a outra. Sozinho, um elo não segura nada. Ligado aos outros, forma uma corrente forte. Aqui, cada pessoa é um elo.',
    exemplo: 'Quando um setor atrasa, o outro sente: o produto não chega, a entrega atrasa e o cliente reclama.',
    pergunta: 'De quem o nosso trabalho depende? E quem depende do nosso trabalho?',
    combinado_sugerido: 'Escolher um setor parceiro e combinar uma melhoria simples na troca de informação.',
  },
  {
    semana: 3, mes: 1, titulo: 'Ajudar o colega, mesmo fora da função',
    codigo_cultura: 'União antes de tudo', citacao: 'Tudo só vai pra frente com união.',
    fala_abertura: "União é ajudar o colega mesmo fora da sua função, dividir a informação e comemorar o resultado do time, não só o seu. Fofoca e 'time contra time' não combinam com a gente.",
    exemplo: 'O colega do lado está com fila ou carga acumulada. Você terminou a sua parte e oferece ajuda, sem esperar pedido.',
    pergunta: 'Em que momento da semana a equipe mais precisa de ajuda?',
    combinado_sugerido: 'No horário de mais movimento, quem estiver livre pergunta: "Posso ajudar?"',
  },
  {
    semana: 4, mes: 1, titulo: 'Cumprir ou avisar a tempo',
    codigo_cultura: 'Palavra que vale', citacao: 'Honestidade, confiança e justiça na mesma direção.',
    fala_abertura: 'Ter palavra é cumprir o prazo ou avisar a tempo quando não vai conseguir. É não prometer o que não pode entregar.',
    exemplo: 'Você prometeu ao cliente uma entrega para hoje e viu que vai atrasar. Avisar antes é ter palavra. Deixar o cliente esperando, não.',
    pergunta: 'Que promessa a gente costuma fazer e nem sempre consegue cumprir?',
    combinado_sugerido: 'Avisar o líder assim que perceber que um prazo não vai ser cumprido.',
  },
  {
    semana: 5, mes: 2, titulo: '"Como você está?" antes de cobrar',
    codigo_cultura: 'Cuidado com responsabilidade', citacao: 'Acolhimento e regra andam juntos por aqui.',
    fala_abertura: 'Cuidar de gente e cobrar resultado andam juntos. Perguntamos como o colega está e também falamos, com respeito, do que precisa melhorar.',
    exemplo: 'Um colega chegou calado e errando mais que o normal. Antes de cobrar, o líder pergunta, em particular, se está tudo bem.',
    pergunta: 'Como podemos mostrar cuidado com o colega sem deixar o trabalho de lado?',
    combinado_sugerido: 'Começar o turno cumprimentando cada colega e perguntando como ele está.',
  },
  {
    semana: 6, mes: 2, titulo: 'Cuidar do que é da empresa como se fosse seu',
    codigo_cultura: 'Atitude de dono', citacao: 'Dor de dono, amor de dono, atitude de dono.',
    fala_abertura: 'Atitude de dono é cuidar do material, do tempo e do dinheiro da empresa com o mesmo cuidado que um dono teria. Não é sobre cargo, é sobre atitude.',
    exemplo: 'Luz ou ar-condicionado ligado sem ninguém, embalagem jogada fora sem necessidade, produto mal guardado que estraga.',
    pergunta: 'Onde estamos perdendo material, tempo ou dinheiro no nosso setor?',
    combinado_sugerido: 'Escolher um desperdício e combinar como evitar nesta semana.',
  },
  {
    semana: 7, mes: 2, titulo: 'Pedir ajuda quando não sabe',
    codigo_cultura: 'Humildade na forma de tratar', citacao: 'Sempre há o que aprender, em qualquer cargo.',
    fala_abertura: 'Humildade é pedir ajuda quando não sabe, aceitar uma orientação sem se defender e respeitar quem pensa diferente.',
    exemplo: 'Um colega novo mostra um jeito mais rápido de fazer uma tarefa. Quem tem mais tempo de casa escuta e experimenta.',
    pergunta: 'O que cada um aqui pode ensinar para o grupo?',
    combinado_sugerido: 'Na dúvida, perguntar antes de fazer.',
  },
  {
    semana: 8, mes: 2, titulo: 'Bem-feito, não só rápido',
    codigo_cultura: 'Resultado que sustenta', citacao: 'Resultado do jeito errado não vale, porque não se sustenta.',
    fala_abertura: 'Entregar rápido é bom. Entregar rápido e bem-feito é melhor. Buscamos resultado com cultura, nunca resultado a qualquer custo.',
    exemplo: 'Fechar o caixa com pressa e errar o troco. Carregar o caminhão rápido e danificar a mercadoria. Refazer custa mais caro.',
    pergunta: 'Onde a pressa está causando erro ou retrabalho?',
    combinado_sugerido: 'Conferir uma etapa importante antes de passar para a próxima.',
  },
  {
    semana: 9, mes: 3, titulo: 'Buscar solução diante do obstáculo',
    codigo_cultura: 'Perseverança para seguir', citacao: 'Não desistimos diante das dificuldades.',
    fala_abertura: 'Perseverança é não desistir quando aparece um problema, buscar solução e aprender com o erro para não repetir.',
    exemplo: 'O sistema caiu, faltou um produto ou um equipamento quebrou. Em vez de parar e reclamar, a equipe busca outro jeito de atender e avisa quem pode resolver.',
    pergunta: 'Qual dificuldade se repete aqui e o que podemos tentar de diferente?',
    combinado_sugerido: 'Escolher um problema que se repete e testar uma solução durante a semana.',
  },
  {
    semana: 10, mes: 3, titulo: 'Errar pode ensinar. Esconder, não',
    codigo_cultura: 'Como tratamos o erro', citacao: 'Ninguém é humilhado por errar.',
    fala_abertura: 'Erro honesto faz parte. Erro por falta de cuidado precisa ser conversado. Esconder o erro de propósito quebra a confiança.',
    exemplo: 'Você registrou um preço errado ou mandou uma entrega para o endereço errado. Avisar logo permite corrigir rápido. Esconder piora o problema.',
    pergunta: 'O que ajuda a gente a avisar um erro logo que ele acontece?',
    combinado_sugerido: 'Quem avisar um erro recebe ajuda para corrigir, sem humilhação.',
  },
  {
    semana: 11, mes: 3, titulo: 'Conversa direta no lugar de fofoca',
    codigo_cultura: 'Feedback e inegociáveis', citacao: "'Fofoca no lugar de conversa direta' não cabe aqui.",
    fala_abertura: 'Quando algo incomoda, a conversa é com a pessoa, com respeito e na hora certa. Fofoca não resolve e enfraquece a corrente.',
    exemplo: 'Um colega sempre deixa o setor bagunçado na troca de turno. Em vez de comentar com os outros, você fala com ele, com calma.',
    pergunta: 'O que torna mais fácil conversar direto com um colega?',
    combinado_sugerido: 'Assunto que incomoda é tratado com a pessoa ou com o líder, nunca pelas costas.',
  },
  {
    semana: 12, mes: 3, titulo: 'Reconhecimento também é feedback',
    codigo_cultura: 'Nossa cultura de feedback', citacao: 'Feedback não é punição. É cuidado, dito em voz alta, no tempo certo.',
    fala_abertura: "Feedback não é só correção. Dizer 'obrigado, ficou muito bom' também é feedback e dá vontade de continuar.",
    exemplo: 'Um colega ficou para ajudar no fechamento ou atendeu muito bem um cliente difícil. Isso merece ser dito na frente da equipe.',
    pergunta: 'Que boa atitude você viu num colega nas últimas semanas?',
    combinado_sugerido: 'Cada pessoa reconhece pelo menos uma boa atitude de um colega nesta semana.',
  },
  {
    semana: 13, mes: 3, titulo: 'O que mudou na nossa equipe',
    codigo_cultura: 'Raízes, Proximidade e Oportunidades', citacao: 'Nossa tríade: Raízes, Proximidade e Oportunidades.',
    fala_abertura: 'Nestes três meses, falamos de união, palavra, cuidado, atitude de dono, humildade, resultado e perseverança. Hoje vamos olhar o que mudou.',
    exemplo: 'Leia dois ou três combinados que deram certo no trimestre e agradeça quem fez acontecer.',
    pergunta: 'O que melhorou na nossa equipe? O que ainda precisa melhorar?',
    combinado_sugerido: 'Escolher o combinado que vai continuar no próximo ciclo.',
  },
];

export const ETAPAS = [
  { n: 1, nome: 'Oração inicial', min: 2 },
  { n: 2, nome: 'Conferir o combinado anterior', min: 2 },
  { n: 3, nome: 'Apresentar o tema do dia', min: 4 },
  { n: 4, nome: 'Ouvir a equipe', min: 3 },
  { n: 5, nome: 'Definir o combinado', min: 2 },
  { n: 6, nome: 'Confirmar e encerrar', min: 2 },
] as const;

export const DURACAO_TOTAL_SEG = ETAPAS.reduce((s, e) => s + e.min * 60, 0); // 900

export const FOCO_MES: Record<number, { nome: string; descricao: string }> = {
  1: { nome: 'Entender', descricao: 'Apresentar o jeito de ser do grupo e traduzir os valores em atitudes simples.' },
  2: { nome: 'Praticar', descricao: 'Situações reais de atendimento, comunicação, cooperação e responsabilidade.' },
  3: { nome: 'Fortalecer', descricao: 'Retomar combinados, reconhecer boas atitudes e ajustar o que ainda precisa melhorar.' },
};

export function etapaAtual(segundos: number): number {
  let acc = 0;
  for (const e of ETAPAS) {
    acc += e.min * 60;
    if (segundos < acc) return e.n;
  }
  return ETAPAS.length;
}
