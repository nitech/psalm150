VERSION 5.00

Begin VB.Form frmSplash
    BackColor = 16777215
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    BorderStyle = 1
    LinkTopic = "Form2"
    MaxButton = 0              'False
    MinButton = 0              'False
    ControlBox = 0              'False
    KeyPreview = -1              'True
    ClipControls = 0              'False
    ClientLeft   = 225
    ClientTop    = 1380
    ClientWidth  = 5850
    ClientHeight = 2460
    ShowInTaskbar = 0              'False
    StartupPosition = 2
    Begin VB.Timer Timer1
        Left = 3930
        Top = 780
    End
    Begin VB.Label lblSplash
        Caption = "Build"
        Index = 2
        Left   = 1320
        Top    = 1530
        Width  = 435
        Height = 240
        TabIndex = 3
        AutoSize = -1              'True
        BackStyle = 0
        BeginProperty Font
            Name          = "Arial"
            Size          = 9,75
            Charset       = 0
            Weight        = 400
            Underline     = 0              'False
            Italic        = 0              'False
            Strikethrough = 0              'False
        EndProperty
    End
    Begin VB.Image Image1
        Picture = frmSplash.frx:0000
        Left   = 600
        Top    = 390
        Width  = 480
        Height = 480
    End
    Begin VB.Label lblSplash
        Caption = "Copyright ©"
        Index = 3
        ForeColor = 0
        Left   = 1320
        Top    = 1785
        Width  = 1035
        Height = 240
        TabIndex = 2
        AutoSize = -1              'True
        BackStyle = 0
        BeginProperty Font
            Name          = "Arial"
            Size          = 9,75
            Charset       = 0
            Weight        = 400
            Underline     = 0              'False
            Italic        = 0              'False
            Strikethrough = 0              'False
        EndProperty
    End
    Begin VB.Label lblSplash
        Caption = "x"
        Index = 0
        ForeColor = 0
        Left   = 1260
        Top    = 390
        Width  = 225
        Height = 480
        TabIndex = 1
        AutoSize = -1              'True
        BackStyle = 0
        BeginProperty Font
            Name          = "Arial"
            Size          = 20,25
            Charset       = 0
            Weight        = 700
            Underline     = 0              'False
            Italic        = 0              'False
            Strikethrough = 0              'False
        EndProperty
    End
    Begin VB.Label lblSplash
        Caption = "Version"
        Index = 1
        ForeColor = 0
        Left   = 1290
        Top    = 1140
        Width  = 975
        Height = 330
        TabIndex = 0
        AutoSize = -1              'True
        BackStyle = 0
        BeginProperty Font
            Name          = "Arial"
            Size          = 14,25
            Charset       = 0
            Weight        = 400
            Underline     = 0              'False
            Italic        = 0              'False
            Strikethrough = 0              'False
        EndProperty
    End
End
