Attribute VB_Name = "SendTickets"
' ============================================================
' Eintrittskarten per Outlook verschicken
'
' Erwartet die Einzel-PDFs aus dem Sheet-Menü
' "Einzel-PDFs für Mailversand (ZIP) erzeugen", entpackt in
' einen Ordner. Dateinamen-Schema:
'   "Nachname, Vorname - Ticket 1von3.pdf"
' Alle Tickets einer Person werden in EINE Mail gehängt; der
' Empfänger wird als "Vorname Nachname" im Outlook-Adressbuch
' aufgelöst.
'
' Einrichtung (einmalig):
'   1. Outlook: Alt+F11 (VBA-Editor) -> Rechtsklick "Projekt1"
'      -> Einfügen -> Modul -> diesen Code hineinkopieren
'   2. TICKET_FOLDER unten anpassen
'   3. Ausführen: F5 in "EintrittskartenVersenden"
'      (oder Alt+F8 in Outlook)
'
' SEND_DIRECT = False: Mails landen nur im Entwürfe-Ordner
' (zum Prüfen). Auf True stellen für Direktversand.
' ============================================================

Const TICKET_FOLDER As String = "C:\Eintrittskarten"
Const MAIL_SUBJECT As String = "Deine Eintrittskarte(n)"
Const SEND_DIRECT As Boolean = False

Sub EintrittskartenVersenden()
    Dim fso As Object, fl As Object, f As Object
    Dim dict As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    Set dict = CreateObject("Scripting.Dictionary")

    If Not fso.FolderExists(TICKET_FOLDER) Then
        MsgBox "Ordner nicht gefunden: " & TICKET_FOLDER, vbExclamation
        Exit Sub
    End If

    ' PDFs nach Person gruppieren ("Nachname, Vorname")
    Set fl = fso.GetFolder(TICKET_FOLDER)
    For Each f In fl.Files
        If LCase(fso.GetExtensionName(f.Name)) = "pdf" Then
            Dim pos As Long, key As String
            pos = InStr(f.Name, " - Ticket")
            If pos > 0 Then
                key = Left(f.Name, pos - 1)
                If Not dict.Exists(key) Then dict.Add key, New Collection
                dict(key).Add f.Path
            End If
        End If
    Next

    If dict.Count = 0 Then
        MsgBox "Keine Ticket-PDFs im Ordner gefunden.", vbExclamation
        Exit Sub
    End If

    Dim k As Variant, p As Variant
    Dim created As Long, unresolved As String

    For Each k In dict.Keys
        Dim parts() As String, vorname As String, nachname As String
        parts = Split(k, ", ")
        nachname = parts(0)
        If UBound(parts) >= 1 Then vorname = parts(1) Else vorname = ""

        Dim mail As Object, r As Object
        Set mail = Application.CreateItem(0) ' olMailItem
        mail.Subject = MAIL_SUBJECT
        mail.Body = "Hallo " & vorname & "," & vbCrLf & vbCrLf & _
            "anbei deine Eintrittskarte(n) als PDF." & vbCrLf & _
            "Bitte bring den QR-Code ausgedruckt oder auf dem Handy mit zum Einlass." & vbCrLf & vbCrLf & _
            "Viele Grüße"

        For Each p In dict(k)
            mail.Attachments.Add CStr(p)
        Next

        Set r = mail.Recipients.Add(vorname & " " & nachname)
        r.Resolve

        If Not r.Resolved Then
            ' Nicht eindeutig im Adressbuch: als Entwurf ablegen,
            ' Empfänger von Hand nachtragen
            unresolved = unresolved & vbCrLf & "  " & k
            mail.Save
        ElseIf SEND_DIRECT Then
            mail.Send
            created = created + 1
        Else
            mail.Save
            created = created + 1
        End If
    Next

    Dim msg As String
    If SEND_DIRECT Then
        msg = created & " Mails versendet."
    Else
        msg = created & " Mails als Entwurf erstellt (Ordner 'Entwürfe')." & vbCrLf & _
              "Zum Direktversand SEND_DIRECT = True setzen."
    End If
    If unresolved <> "" Then
        msg = msg & vbCrLf & vbCrLf & _
            "Nicht im Adressbuch gefunden (Entwurf ohne Empfänger):" & unresolved
    End If
    MsgBox msg, vbInformation
End Sub
