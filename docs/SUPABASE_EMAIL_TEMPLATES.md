# Templates de E-mail da MA Refeições (Supabase Auth)

Este documento contém os modelos oficiais de e-mail em HTML responsivo para configuração no painel do **Supabase**.

---

## 1. Onde configurar no Supabase

1. Acesse o painel do Supabase: **[https://supabase.com/dashboard](https://supabase.com/dashboard)**.
2. Selecione o projeto.
3. No menu lateral, vá em **Authentication** -> **Email Templates**.
4. Configure os dois templates abaixo (**Invite user** e **Reset password**).
5. Em **Authentication** -> **URL Configuration**:
   - Defina a **Site URL** com o endereço real de acesso do seu sistema (ex: `https://seu-dominio.com` ou o IP de homologação).
   - Em **Redirect URLs**, adicione:
     - `http://localhost:3000/**`
     - `https://seu-dominio.com/**`
     - `http://192.168.*:*/**` (caso acesse por rede local).

---

## 2. Template: Convite de Usuário / Primeiro Acesso (Invite User)

> **No Supabase:** Aba **Authentication** -> **Email Templates** -> **Invite user**  
> **Subject (Assunto):** `Convite de acesso ao Sistema MA Refeições`

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ativação de Conta - MA Refeições</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);">
          <!-- Cabeçalho -->
          <tr>
            <td style="background: linear-gradient(135deg, #7F1D1D 0%, #C5161D 100%); padding: 36px 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 900; letter-spacing: -0.5px;">MA Refeições</h1>
              <p style="margin: 6px 0 0; color: rgba(255, 255, 255, 0.85); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;">Sistema de Controle de Refeições</p>
            </td>
          </tr>

          <!-- Conteúdo -->
          <tr>
            <td style="padding: 40px 32px;">
              <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 20px; font-weight: 800;">Olá! Seu acesso está pronto.</h2>
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 24px; color: #475569;">
                Você foi cadastrado no <strong>Sistema MA Refeições</strong>. Para começar a utilizar o portal de comensais e acompanhar suas refeições, ative sua conta e defina sua senha pessoal.
              </p>

              <!-- Botão de Ação -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" style="border-radius: 12px; background-color: #C5161D;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 800; color: #ffffff; text-decoration: none; border-radius: 12px; background-color: #C5161D;">
                      Ativar Minha Conta e Criar Senha
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 12px; font-size: 13px; color: #64748b; line-height: 20px;">
                Se o botão acima não funcionar, copie e cole o endereço abaixo no seu navegador:
              </p>
              <p style="margin: 0 0 28px; word-break: break-all; font-size: 12px; line-height: 18px; color: #C5161D; background-color: #fef2f2; padding: 12px; border-radius: 8px;">
                {{ .ConfirmationURL }}
              </p>

              <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 20px;">
                <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 18px;">
                  Este link é de uso individual e intransferível. Se você não esperava este e-mail, por favor desconsidere.
                </p>
              </div>
            </td>
          </tr>

          <!-- Rodapé -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0; font-size: 12px; color: #64748b; font-weight: 600;">MA Refeições • Gestão Integrada de Refeições</p>
              <p style="margin: 4px 0 0; font-size: 11px; color: #94a3b8;">Mensagem gerada automaticamente pelo sistema.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 3. Template: Redefinição de Senha (Reset Password)

> **No Supabase:** Aba **Authentication** -> **Email Templates** -> **Reset password**  
> **Subject (Assunto):** `Redefinição de senha - MA Refeições`

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redefinição de Senha - MA Refeições</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);">
          <!-- Cabeçalho -->
          <tr>
            <td style="background: linear-gradient(135deg, #7F1D1D 0%, #C5161D 100%); padding: 36px 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 900; letter-spacing: -0.5px;">MA Refeições</h1>
              <p style="margin: 6px 0 0; color: rgba(255, 255, 255, 0.85); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;">Sistema de Controle de Refeições</p>
            </td>
          </tr>

          <!-- Conteúdo -->
          <tr>
            <td style="padding: 40px 32px;">
              <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 20px; font-weight: 800;">Solicitação de redefinição de senha</h2>
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 24px; color: #475569;">
                Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Sistema MA Refeições</strong>. Clique no botão abaixo para escolher uma nova senha:
              </p>

              <!-- Botão de Ação -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" style="border-radius: 12px; background-color: #C5161D;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 800; color: #ffffff; text-decoration: none; border-radius: 12px; background-color: #C5161D;">
                      Redefinir Minha Senha
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 12px; font-size: 13px; color: #64748b; line-height: 20px;">
                Se o botão acima não funcionar, copie e cole o link abaixo no seu navegador:
              </p>
              <p style="margin: 0 0 28px; word-break: break-all; font-size: 12px; line-height: 18px; color: #C5161D; background-color: #fef2f2; padding: 12px; border-radius: 8px;">
                {{ .ConfirmationURL }}
              </p>

              <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 20px;">
                <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 18px;">
                  Se você não solicitou a redefinição de senha, ignore este e-mail com segurança. Sua senha atual permanecerá inalterada.
                </p>
              </div>
            </td>
          </tr>

          <!-- Rodapé -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0; font-size: 12px; color: #64748b; font-weight: 600;">MA Refeições • Gestão Integrada de Refeições</p>
              <p style="margin: 4px 0 0; font-size: 11px; color: #94a3b8;">Mensagem gerada automaticamente pelo sistema.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```
