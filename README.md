# Vale do Ouro — Central de Vendas

Sistema de consulta comercial dos lotes, preparado como site estático para o GitHub Pages e conectado ao Supabase.

## O que já funciona

- planta vetorial extraída do DWG, com os 110 lotes posicionados no desenho real;
- alternativa de visualização em grade por quadras;
- filtros por quadra, situação e busca direta;
- área, preço, entrada e situação de cada lote;
- simulador com os mesmos prazos e fatores da planilha;
- login individual dos corretores por e-mail e senha;
- leitura dos 110 lotes diretamente do Supabase;
- reserva atômica no banco, evitando que dois corretores reservem o mesmo lote;
- cadastro seguro de novos corretores pelo painel administrativo;
- exportação da lista filtrada para Excel;
- relatório em PDF pela janela de impressão do navegador;
- recortes da planta técnica para conferência visual;
- integração protegida com autenticação, reservas e administração no Supabase.

## Executar localmente

O site usa `fetch` para carregar os dados, portanto deve ser aberto por um servidor local. Na pasta do projeto, use qualquer servidor estático. Um exemplo com Python:

```powershell
python -m http.server 4173
```

Depois abra `http://localhost:4173`.

## Publicar no GitHub Pages

1. Crie um repositório e envie o conteúdo desta pasta.
2. No GitHub, abra **Settings → Pages**.
3. Em **Build and deployment**, selecione **Deploy from a branch**.
4. Escolha a branch principal e a pasta raiz.

## Reserva pública, sem corretor

`publico.html` é uma página separada (link "Reservar sem corretor" no cabeçalho de
`index.html`) onde qualquer visitante pode ver o mapa interativo e reservar um lote
disponível sem fazer login, com validade fixa de 5 dias corridos. Ela usa duas funções
novas no Supabase (`public_list_lots` e `public_reserve_lot`) que precisam ser criadas
uma única vez: rode `supabase/public-reservation.sql` no SQL Editor do projeto. O
arquivo tem um comentário no topo explicando as suposições sobre o schema — confira
antes de rodar.

## Configuração do Supabase

O projeto já usa autenticação, leitura protegida dos lotes e a função de reserva. O arquivo `config.js` contém apenas a URL e a chave **publicável** do projeto, apropriadas para um site público com RLS ativado. Nunca coloque uma chave `secret` ou `service_role` no site ou no GitHub.

Para cadastrar outros corretores, use **Authentication → Users → Add user** no painel do Supabase. As regras administrativas e os dados comerciais permanecem no banco e não fazem parte deste repositório público.

## Planta vetorial

O arquivo `assets/planta-dwg.svg` foi convertido localmente do projeto AutoCAD e `data/lot-map.json` liga as geometrias aos identificadores comerciais. O DWG possui 107 parcelas fechadas válidas na camada de lotes. O H-11, aberto no arquivo original, é reconstruído pelas divisas dos lotes vizinhos. F-1 e G-1 aparecem como marcadores sobre suas posições técnicas.

As medidas de frente, fundo e laterais ficam em `data/lot-measures.json` e foram extraídas exclusivamente da coluna de descrição da planilha técnica `MEDIDAS LOTES - LOTEAMENTO VALE DO OURO.xlsx`. Os valores comerciais dessa planilha não são importados. Ela contém medidas para 98 lotes e não inclui as quadras E, F e G.

## Painel administrativo

O sistema possui perfil de administrador, funções protegidas para alterar lotes e cancelar reservas, consulta geral de reservas e histórico de auditoria. O primeiro usuário criado no projeto recebe o perfil administrativo; os usuários cadastrados posteriormente permanecem como corretores comuns. No site, o botão **Administração** só aparece para administradores.

O DWG original, as ferramentas de extração, as planilhas comerciais e os arquivos internos do banco não são enviados ao GitHub. Somente os arquivos preparados para o funcionamento do site fazem parte da versão pública.

## Privacidade

Nomes de clientes e números de contrato da planilha original não foram colocados na base pública. Eles devem ficar somente no Supabase, protegidos por autenticação e políticas de acesso. Não envie a planilha original nem um arquivo com dados pessoais para um repositório público.

## Observações da fonte

- A planilha contém 108 lotes cadastrados.
- A planta técnica contém 110 lotes.
- F-1 e G-1 aparecem na planta, mas não têm preço na planilha e foram marcados como cadastro pendente.
- A classificação de situação foi deduzida do preenchimento atual da coluna de cliente: vazio = disponível; nome/contrato = vendido; “reservado” = reservado; permuta, ocupado, cartório ou indisponível = indisponível.
- K-4, L-1, L-2 e M-1 têm divergência entre `área × valor por m²` e o valor total informado. O protótipo preserva o valor total da planilha e mostra um aviso ao abrir esses lotes; os quatro registros devem ser conferidos antes da produção.
