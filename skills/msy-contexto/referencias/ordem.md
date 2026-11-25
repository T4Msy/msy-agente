# A Ordem: hierarquia, acesso e vocabulário

## Hierarquia (página "Estrutura da Ordem" do portal)

| Nível | Cargo | Papel |
|---|---|---|
| 1 | Fundador & Grão-Mestre | Direção estratégica, cultura, decisões fundamentais |
| 2 | Coordenador Geral | Coordena as operações e o alinhamento entre áreas |
| 3 | Secretária Geral / Chefe de Estrutura | Organização interna, documentação, registros, comunicações formais |
| 3 | Supervisor de Execução | Atividades e projetos executados com qualidade e no prazo |
| 4 | Redatora Oficial | Comunicados, atas, artigos e materiais escritos |
| 4 | Designer Oficial | Identidade visual, materiais gráficos, apresentações, assets |
| 5 | Membro | Participa, cumpre os deveres, tem voz |

## Dois tipos de "cargo" no portal (não confunda)

- `profiles.role`: o **cargo na Ordem** (texto livre, ex.: "Designer Oficial").
- `project_participants.roles[]`: o **papel em um projeto** (UX/UI, Front-end, Back-end, QA, DevOps, Gestor…).
  É este que define como o agente ajuda numa tarefa. Uma pessoa pode ter papéis diferentes em projetos diferentes.
- `profiles.tier`: `diretoria` (administração) ou `membro`. Permissões extras ficam em `member_permissions`.
- No projeto, **gestor** = quem criou o projeto ou participante com `is_manager`. Gestor cria/edita tarefas e aprova.

## Ciclo da tarefa de projeto

`nao_iniciada` → (responsável inicia) `em_andamento` → (responsável pede revisão) `em_revisao` →
(gestor; responsável que não é gestor não aprova a si mesmo) `concluida` ou `necessita_ajustes` → volta para `em_andamento`.
Também existe `bloqueada`. O tempo é contado entre iniciar e pedir revisão. O banco garante essas regras.

## Vocabulário do portal

- **Atividades**: missões da Ordem atribuídas a membros (diferente de tarefa de projeto). Status: Pendente, Em andamento, Concluída, Incompleta, Cancelada.
- **Eventos / Reuniões / Presenças**: agenda da Ordem; presença conta no desempenho.
- **Ranking / Premiações / Insígnias**: reconhecimento por mérito (mensagens, atividades, presença).
- **Mensalidade**: contribuição mensal do membro.
- **ICM³**: avaliação psicométrica (módulo congelado, não mexer).
- **Supervisão / Huginn**: área da coordenação; Huginn mede a "saúde" da Masayoshi.
- **MSY Space**: chat e salas de voz da Ordem (web e app Android).
- **Jornal**: publicações internas. **Feed**: rede social interna. **Biblioteca**: materiais.
- **Corvo / corvinho** e **taça de vinho**: símbolos da Masayoshi.
