!include "nsDialogs.nsh"

!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Compasso"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Compasso"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Organon"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Organon"
  ${EndIf}
!macroend

; Older app versions send these flags without /S. Keep their updates silent too.
; Opening the installer normally still shows the full first-install wizard.
!macro customInit
  ${If} ${isUpdated}
  ${AndIf} ${isForceRun}
    SetSilent silent
  ${EndIf}
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao Organon"
  !define MUI_WELCOMEPAGE_TEXT "Organon para Windows com planos por dia da semana, cronômetro de aulas e descansos, caderno com imagens e histórico de estudo.$\r$\n$\r$\nO Organon preserva seus dados locais ao atualizar.$\r$\n$\r$\nNas próximas etapas, escolha onde instalar e confirme a instalação.$\r$\n$\r$\nClique em Próximo para continuar."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Page custom OrganonConfirmPage
  Function OrganonConfirmPage
    !insertmacro MUI_HEADER_TEXT "Confirmar instalação" "Confira a pasta antes de instalar."
    ; Match electron-builder's directory normalization before showing the final path.
    ${StrContains} $1 "${APP_FILENAME}" $INSTDIR
    ${If} $1 == ""
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${EndIf}
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 8u 100% 22u "O Organon será instalado nesta pasta:"
    Pop $0
    ${NSD_CreateLabel} 0 34u 100% 42u "$INSTDIR"
    Pop $0
    ${NSD_CreateLabel} 0 86u 100% 36u "Clique em Instalar para confirmar, ou em Voltar para alterar a pasta."
    Pop $0
    GetDlgItem $1 $HWNDPARENT 1
    SendMessage $1 ${WM_SETTEXT} 0 "STR:Instalar"
    nsDialogs::Show
  FunctionEnd
!macroend

!macro customFinishPage
  Function OrganonStartApp
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
  !define MUI_FINISHPAGE_TITLE "Instalado com sucesso"
  !define MUI_FINISHPAGE_TEXT "O Organon está pronto para usar.$\r$\n$\r$\nDeseja abrir o aplicativo? Marque a opção abaixo e clique em Concluir."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_NOTCHECKED
  !define MUI_FINISHPAGE_RUN_TEXT "Abrir o Organon agora"
  !define MUI_FINISHPAGE_RUN_FUNCTION "OrganonStartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend
