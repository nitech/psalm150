VERSION 5.00
Object = "{86CF1D34-0C5F-11D2-A9FC-0000F8754DA1}#2.0#0"; "C:\Program Files (x86)\VBReFormer\Lib\MSCOMCT2.OCX"

Begin VB.Form frmVSBOptions
    Caption = "Options"
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    BorderStyle = 3
    LinkTopic = "Form1"
    MaxButton = 0              'False
    MinButton = 0              'False
    ClientLeft   = 45
    ClientTop    = 330
    ClientWidth  = 5565
    ClientHeight = 5520
    ShowInTaskbar = 0              'False
    StartupPosition = 2
    Begin VB.Frame Frame3
        Caption = "General"
        Left   = 180
        Top    = 150
        Width  = 5205
        Height = 1215
        TabIndex = 13
        Begin VB.OptionButton optKeyFormat
            Caption = "Compressed (i.e. Eb - F)"
            Index = 1
            Left   = 2040
            Top    = 540
            Width  = 2565
            Height = 315
            TabIndex = 15
        End
        Begin VB.OptionButton optKeyFormat
            Caption = "Expanded (i.e. Eb / E / F)"
            Index = 0
            Left   = 2040
            Top    = 330
            Width  = 2505
            Height = 195
            TabIndex = 0
        End
        Begin VB.Label Label5
            Caption = "Key Display Format:"
            Left   = 390
            Top    = 330
            Width  = 1395
            Height = 195
            TabIndex = 14
            AutoSize = -1              'True
        End
    End
    Begin VB.Frame Frame2
        Caption = "Slide Show Navigation Toolbar"
        Left   = 180
        Top    = 3240
        Width  = 5205
        Height = 1605
        TabIndex = 8
        Begin VB.ComboBox cboResolution
            Style = 2
            Left   = 2520
            Top    = 1110
            Width  = 1755
            Height = 315
            Text = ""
            TabIndex = 3
        End
        Begin VB.Label Label4
            Caption = "Slide show resolution:"
            Left   = 330
            Top    = 1140
            Width  = 1530
            Height = 195
            TabIndex = 12
            AutoSize = -1              'True
        End
        Begin VB.Label Label3
            Caption = "The navigation toolbar is enabled when the slide show resolution is lower than that of the display device."
            Left   = 330
            Top    = 420
            Width  = 4665
            Height = 465
            TabIndex = 11
        End
    End
    Begin VB.CommandButton cmdCancel
        Caption = "Cancel"
        Left   = 2828
        Top    = 5010
        Width  = 1185
        Height = 345
        TabIndex = 5
        Cancel = -1              'True
    End
    Begin VB.CommandButton cmdOK
        Caption = "OK"
        Left   = 1538
        Top    = 5010
        Width  = 1185
        Height = 345
        TabIndex = 4
        Default = -1              'True
    End
    Begin VB.Frame Frame1
        Caption = "History"
        Left   = 180
        Top    = 1530
        Width  = 5205
        Height = 1545
        TabIndex = 6
        Begin VB.CommandButton cmdClearHistory
            Caption = "Clear History"
            Left   = 3690
            Top    = 1050
            Width  = 1185
            Height = 345
            TabIndex = 2
        End
        Begin MSComCtl2.UpDown UpDown1
            Left   = 3300
            Top    = 1080
            Width  = 240
            Height = 285
            TabStop = 0              'False
            TabIndex = 7
            OleObjectBlob = frmVSBOptions.frx:0000
        End
        Begin VB.TextBox txtHistoryDays
            Left   = 2790
            Top    = 1080
            Width  = 495
            Height = 285
            Text = "Text1"
            TabIndex = 1
        End
        Begin VB.Label Label2
            Caption = "The history tab contains the songs displayed in slide show view, providing quick access to recently viewed songs."
            Left   = 330
            Top    = 420
            Width  = 4665
            Height = 465
            TabIndex = 10
        End
        Begin VB.Label Label1
            Caption = "Days to keep songs in history:"
            Left   = 330
            Top    = 1110
            Width  = 2115
            Height = 195
            TabIndex = 9
            AutoSize = -1              'True
        End
    End
End
