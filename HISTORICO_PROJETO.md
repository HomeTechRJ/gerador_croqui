# Histórico do projeto

Última atualização: 09/09/2026

Este arquivo registra as decisões confirmadas e os pontos que ainda precisam de ajuste. A referência aprovada é o print enviado com a frase **“esse é o resultado final que tem que ficar o quarto das meninas”**. Os prints posteriores mostram falhas do sistema, não novas posições desejadas.

## O que está certo

| Item | Status | Observação |
| --- | --- | --- |
| Quadro de automação | ✅ Confirmado | O usuário confirmou que está correto. |
| Tela inicial | ✅ Implementado | O sistema inicia no seletor de projetos. |
| Plantas do projeto | ✅ Implementado | A planta salva permanece vinculada ao projeto e não precisa ser reenviada a cada acesso. |
| Fechar planta | ✅ Implementado | A planta pode ser fechada de verdade e não aparece como “reabrir” na interface. |
| Excluir projeto | ✅ Implementado | O projeto e seus arquivos relacionados podem ser excluídos. |
| Briefing após abrir a planta | ✅ Implementado | O briefing é configurado depois que a planta está disponível. |
| Cadastro manual de cômodo | ✅ Implementado | Permite incluir um cômodo que o detector não encontrou, como banheiro. |
| Serviços do projeto | ✅ Implementado | O briefing permite selecionar áudio, vídeo, rede, automação, segurança e energia. |
| Áudio Bluetooth | ✅ Implementado | Existe como opção de sistema de áudio. |
| Limpar sugestões | ✅ Implementado | Remove os símbolos da planta atual para gerar novamente. |
| Rascunho ao editar briefing | 🧪 Correção testada | O editor preserva os elementos ainda não salvos ao entrar no briefing e ao voltar para a planta. |
| Regra de rede do escritório | 🧪 Referência aplicada; aguardando aceite | São 3 pontos: um para cada computador e um para uma possível impressora. Os dois computadores foram marcados pelo usuário; o terceiro fica imediatamente ao lado do computador esquerdo, na mesma bancada superior. |

## O que ainda precisa acertar

| Item | Status | Regra esperada |
| --- | --- | --- |
| Caixas de som no Quarto das Meninas | 🧪 Correção testada; aguardando aceite | Duas posições calibradas no PDF original, nos pés das camas, voltados para a estante. Conferidas no editor e na exportação. |
| Caixas Bluetooth no Quarto das Meninas | 🧪 Correção testada; aguardando aceite | As duas caixas usam o símbolo Bluetooth quando selecionado no briefing. Quantidade zero e serviços desmarcados continuam respeitados. |
| Pontos de rede no Quarto das Meninas | 🧪 Correção testada; aguardando aceite | Dois pontos juntos, sobre a parte esquerda da estante superior. Não dependem do retângulo estimado ao redor do nome do cômodo. |
| Limite geométrico de outros cômodos | ⚠️ Pendente | A detecção genérica ainda não comprova paredes nem móveis. Rede sem referência/apoio identificado fica pendente, com aviso da quantidade, em vez de ser lançada em posições estimadas. |
| Validação em outras plantas | ⚠️ Parcial | Testes garantem que a calibração não se aplica a PDFs diferentes nem a outros cômodos. Ainda falta validar o posicionamento arquitetônico dos demais ambientes. |

## Referência fixa: Quarto das Meninas

O posicionamento final enviado pelo usuário é:

1. Rede sobre a parte esquerda da estante superior, com os dois pontos próximos um do outro.
2. Duas caixas nos pés das camas: **extremidades superiores do desenho, voltadas para a estante**. Os travesseiros e a mesa de cabeceira estão na parte inferior; essa não é a posição das caixas.
3. Nenhum símbolo pode sair do contorno do quarto ou aparecer em outro ambiente da prancha.
4. O quadro de automação permanece como está; não deve ser alterado por essa correção.

## Correção técnica de 09/09/2026

- A posição anterior usava um retângulo estimado a partir do rótulo do quarto. Alterar proporções desse retângulo continuava deslocando os símbolos.
- Agora a referência está vinculada ao conteúdo exato do PDF por SHA-256, com coordenadas em pontos PDF convertidas pelo mesmo viewport da planta. Reimportar o arquivo idêntico preserva a referência; outro PDF com o mesmo nome de quarto não a recebe.
- O arquivo tem rótulos textuais de cômodos, mas não oferece os textos de móveis necessários para localizar as camas e a estante pelo detector atual. Esta é uma calibração específica, não uma detecção genérica de mobiliário.
- O canvas não pode mais encolher horizontalmente pelo layout flex; sua proporção acompanha a do PDF.
- **Aplicar referências da planta** substitui somente os itens dos ambientes calibrados na planta ativa, conforme o briefing. Preserva o quadro de automação, UniFi e os outros cômodos. Não é necessário limpar a planta inteira. Depois, usar **Salvar versão** para guardar o resultado.
- Pontos antigos de outros cômodos não são apagados por essa ação. A geração nova informa locais de rede pendentes, sem modificar o quantitativo do briefing.
- Ao clicar em **Editar briefing**, o editor envia uma cópia dos pontos atuais para a etapa de perguntas. Ao voltar, essa cópia tem prioridade sobre a última versão salva; assim elementos posicionados manualmente não desaparecem por ainda não terem sido salvos.
- Para o escritório, a configuração de um novo cômodo começa com 3 pontos de rede. A sugestão automática também registra a finalidade dos pontos. Um briefing já salvo conserva o número que foi escolhido até ser revisado, para não sobrescrever uma decisão existente silenciosamente.
- A referência do escritório usa o mesmo PDF calibrado do quarto: os pontos são convertidos pelo viewport da planta e ficam na bancada superior (coordenadas lógicas renderizadas aproximadas: 810,362; 824,362; 899,362). Os pontos em 824 e 899 correspondem aos computadores indicados no print; o ponto em 810 é a reserva para possível impressora ao lado do computador esquerdo. Ainda depende do aceite visual do usuário.

## Verificações desta correção

- `npm run test:referencia`: nove testes de posições, escala/orientação, isolamento por PDF, quantidades, Bluetooth e preservação dos demais símbolos.
- Teste em Chrome com o PDF real: geração, ausência de duplicação, reaplicação, correção de ponto arrastado, preservação do quadro, proporção do canvas, zoom/pan e exportação. Sem gravar ou excluir dados do projeto.
- O mesmo teste também abre **Editar briefing**, volta imediatamente para a planta e compara os pontos antes/depois. A API fica bloqueada para gravações durante o teste.
- Evidências locais: `artifacts/quarto-editor-validado.png` e `artifacts/quarto-exportado-validado.png`. A pasta é ignorada pelo Git por conter a planta do cliente.
- Próximo passo: aceite visual do usuário para o quarto. Os demais cômodos continuam exigindo validação própria.
