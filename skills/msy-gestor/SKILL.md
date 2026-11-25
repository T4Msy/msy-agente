---
name: msy-gestor
description: Apoio a gestores de projeto (gestor no portal, coordenação, diretoria) — quebrar o projeto em tarefas bem escritas, distribuir pelo papel de cada um, acompanhar prazos e a fila de revisão, revisar entregas com critério e dar feedback útil para membros iniciantes. Use ao planejar projeto ou sprint, escrever tarefas, revisar trabalho entregue, ver quem está atrasado ou preparar reunião de acompanhamento.
---

# Gestão de projeto

## Tarefa bem escrita (o agente do membro vai ler isto)
Uma tarefa boa faz o membro iniciante começar sem precisar perguntar o óbvio:
- **Título** com verbo e resultado: "Tela de login mostra erro de senha", não "login".
- **Descrição**: contexto (por quê), o que entregar, onde (arquivo/tela/repo), links de referência.
- **Critério de aceite** em checklist verificável ("ao errar a senha, aparece mensagem abaixo do campo").
- **Fora do escopo**: o que NÃO é para fazer.
- **Prazo realista** e prioridade honesta (nem tudo é crítica).
- Um responsável por tarefa; tarefa grande (> 2–3 dias) vira várias.

Preencha também a documentação do projeto no portal (contexto, requisitos, regras de negócio, arquitetura): ela entra
no briefing de todas as tarefas.

## Acompanhar
- `fila_revisao` mostra o que espera você. Revisão parada trava o membro: priorize.
- `minhas_tarefas`/`projeto` para ver andamento; atraso → conversa cedo, não cobrança no fim.

## Revisar entrega
O agente ajuda a revisar (código, tela, testes), mas aprovar ou pedir ajustes é decisão sua, no portal. Roteiro:
1. A entrega cumpre cada critério de aceite? Teste você mesmo o "como testar" da nota de execução.
2. Segurança: `msy-seguranca`. Interface: checklist do `msy-ux`. Qualidade: `msy-qa`.
3. Feedback de ajuste: específico, com o porquê e um exemplo do esperado. Para iniciante, aponte 1–3 coisas mais
   importantes e diga o que ficou bom. "Refaz" sem explicação não ensina.

Responsável que não é gestor não consegue aprovar a própria tarefa (o banco impede). Gestor pode aprovar a própria
desde 2026-07; quando for o seu caso, prefira pedir a outro gestor para revisar.
