# Inventário Florestal — app Android

Coleta de campo e cálculo de inventário florestal (eucalipto e cerrado), com GPS e sem internet.

- `www/`: o app (o mesmo código serve como PWA e como APK).
- `android/`: o projeto Android, gerado pelo Capacitor.
- `.github/workflows/apk.yml`: compila o APK no GitHub a cada envio e publica em **Releases**.

## Configurar uma vez

1. Em **Settings → Secrets and variables → Actions → New repository secret**, crie dois segredos com os valores do arquivo `segredos-github-inventario.txt`:
   - `KEYSTORE_PASSWORD`
   - `KEYSTORE_BASE64`
2. Vá em **Actions**, abra "Gerar APK" e clique em **Run workflow**. A compilação leva uns 5 minutos.
3. O APK aparece em **Releases** (na coluna da direita da página do repositório).

## Instalar no Android

1. No celular ou no tablet, abra a página de Releases do repositório (logado no GitHub, já que o repositório é privado) e baixe o arquivo `.apk`.
2. Toque no arquivo. Na primeira vez, o Android pede para **permitir instalar apps desta fonte** (do navegador ou do app Arquivos). Permita e volte.
3. Se o **Play Protect** avisar que é um app desconhecido, toque em **Mais detalhes → Instalar mesmo assim**.
4. Ao abrir o app, permita a **localização precisa**.

As versões novas instalam por cima da anterior e **mantêm os dados**, desde que sejam assinadas com a mesma chave.

## A chave de assinatura

`inventario-florestal-chave.jks` e `segredos-github-inventario.txt` **não vão para o repositório**. Guarde os dois num lugar seguro, como o gerenciador de senhas ou uma pasta privada do Drive. Sem a chave, uma versão nova não instala por cima e você teria de desinstalar o app, perdendo os dados que não estiverem num backup.

## Passar dados do PWA para o APK

No PWA: *Exportar → Backup (.json)*. No APK: tela inicial → *Importar backup*.
