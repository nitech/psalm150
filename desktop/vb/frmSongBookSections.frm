VERSION 5.00

Begin VB.Form frmSongBookSections
    Caption = "Songbook Sections"
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    BorderStyle = 3
    LinkTopic = "Form1"
    MaxButton = 0              'False
    MinButton = 0              'False
    ClientLeft   = 45
    ClientTop    = 330
    ClientWidth  = 5430
    ClientHeight = 2280
    ShowInTaskbar = 0              'False
    StartupPosition = 1
    Begin VB.CommandButton cmdCancel
        Caption = "Cancel"
        Left   = 2955
        Top    = 1740
        Width  = 1125
        Height = 345
        TabIndex = 1
        Cancel = -1              'True
    End
    Begin VB.CommandButton cmdOK
        Caption = "OK"
        Left   = 1665
        Top    = 1740
        Width  = 1125
        Height = 345
        TabIndex = 0
        Default = -1              'True
    End
    Begin VB.TextBox txtTitle
        Index = 0
        Left   = 2310
        Top    = 1140
        Width  = 3015
        Height = 300
        Text = "Text1"
        TabIndex = 3
    End
    Begin VB.CheckBox chkSection
        Caption = "Songs"
        Index = 0
        Left   = 270
        Top    = 1200
        Width  = 1935
        Height = 195
        TabIndex = 2
    End
    Begin VB.Label Label3
        Caption = "Please select the sections that you want included in the printed song book."
        Left   = 270
        Top    = 150
        Width  = 4485
        Height = 465
        TabIndex = 6
    End
    Begin VB.Label Label2
        Caption = "Title:"
        Left   = 2310
        Top    = 840
        Width  = 345
        Height = 195
        TabIndex = 5
        AutoSize = -1              'True
    End
    Begin VB.Label Label1
        Caption = "Section:"
        Left   = 270
        Top    = 840
        Width  = 585
        Height = 195
        TabIndex = 4
        AutoSize = -1              'True
    End
End
