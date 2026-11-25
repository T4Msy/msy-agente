---
description: Prepara a entrega da tarefa - verificação, revisão de segurança, nota de execução e envio para revisão
argument-hint: [id da tarefa]
---
Use as skills msy-tarefas (passo 6) e msy-seguranca para a tarefa: $ARGUMENTS
(sem id: a tarefa em andamento do membro neste repositório; confirme qual).

1. Rode a verificação do projeto (testes, build, lint) e a funcionalidade de verdade; mostre o resultado.
2. Revisão de segurança do diff da branch. Interface mexida: checklist do msy-ux.
3. Atualize o checklist da tarefa com o que foi feito e verificado.
4. Escreva a nota de execução (o que foi feito, como testar, não verificado, branch/PR) e mostre ao membro.
5. Só com o "sim" do membro: `enviar_revisao` com confirmado=true. Diga que agora o gestor aprova ou pede ajustes no portal.
Se algo não passou, não envie: diga o que falta.
