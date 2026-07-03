# Deploy no Wasmer Edge (wasmer.io)

Este projeto foi ajustado para rodar sem erros no Wasmer Edge, que executa Node.js
em um runtime WebAssembly. A única mudança necessária foi trocar `better-sqlite3`
(módulo nativo, que exige compilação C) por `sql.js` (SQLite compilado em WASM
puro), que funciona nesse ambiente sem problemas. Também foi corrigida a criação
automática da pasta `db/` (antes o app quebrava na primeira execução por essa
pasta não existir).

## Passo a passo

1. Instale o Wasmer CLI (se ainda não tiver):
   curl https://get.wasmer.io -sSfL | sh

2. Faça login:
   wasmer login

3. Dentro desta pasta, rode:
   wasmer deploy

   O CLI vai perguntar o nome do app e o "owner" (sua conta) e criará
   automaticamente o `app.yaml`. Não é necessário `Dockerfile` nem `wasmer.toml`
   manual — o Wasmer detecta o `package.json` e usa o script `start` (`node server.js`).

4. Configure uma variável de ambiente de sessão (recomendado), pela dashboard do
   app em wasmer.io ou via CLI:
   wasmer app secrets create SESSION_SECRET "uma-string-bem-aleatoria"

5. Para criar o usuário admin inicial, rode localmente antes de publicar (o
   arquivo db/data.sqlite gerado fica junto do código), ou use SSH do app
   (se habilitado) depois do deploy:
   ADMIN_USER=admin ADMIN_PASS=suasenha node seed.js

## Observações importantes

- O banco SQLite é salvo em `./db/data.sqlite`, no sistema de arquivos da
  instância. Em produção, use um "volume" persistente do Wasmer Edge
  (https://docs.wasmer.io/edge/guides/volumes/) para não perder os dados a
  cada novo deploy ou reinício da instância.
- Teste sempre localmente antes de publicar:
  npm install
  npm start
  (acesse http://127.0.0.1:3000)
