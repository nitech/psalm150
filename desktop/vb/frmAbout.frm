VERSION 5.00

Begin VB.Form frmAbout
    Caption = "About Visual Song Book"
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    BorderStyle = 3
    LinkTopic = "Form1"
    MaxButton = 0              'False
    MinButton = 0              'False
    ControlBox = 0              'False
    ClientLeft   = 4740
    ClientTop    = 3585
    ClientWidth  = 4875
    ClientHeight = 1830
    PaletteMode = 1
    Begin VB.CommandButton Command1
        Caption = "OK"
        Left   = 3270
        Top    = 1320
        Width  = 1425
        Height = 330
        TabIndex = 0
        Cancel = -1              'True
    End
    Begin VB.Label Label1
        Caption = "Label"
        Index = 2
        Left   = 1110
        Top    = 750
        Width  = 390
        Height = 195
        TabIndex = 3
        AutoSize = -1              'True
    End
    Begin VB.Label Label1
        Caption = "Label"
        Index = 1
        Left   = 1110
        Top    = 465
        Width  = 390
        Height = 195
        TabIndex = 2
        AutoSize = -1              'True
    End
    Begin VB.Label Label1
        Caption = "Label"
        Index = 0
        Left   = 1110
        Top    = 180
        Width  = 390
        Height = 315
        TabIndex = 1
        AutoSize = -1              'True
    End
    Begin VB.Image Image1
        Picture = frmAbout.frx:0000
        Left   = 120
        Top    = 165
        Width  = 480
        Height = 480
    End
End
