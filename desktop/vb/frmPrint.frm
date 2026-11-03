VERSION 5.00

Begin VB.Form frmPrint
    Caption = "Print"
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    BorderStyle = 3
    LinkTopic = "Form1"
    MaxButton = 0              'False
    MinButton = 0              'False
    ClientLeft   = 45
    ClientTop    = 330
    ClientWidth  = 4305
    ClientHeight = 3840
    ShowInTaskbar = 0              'False
    StartupPosition = 1
    Begin VB.Frame Frame1
        Caption = "Page Selection"
        Left   = 360
        Top    = 210
        Width  = 3495
        Height = 2895
        TabIndex = 8
        Begin VB.OptionButton optPageRange
            Caption = "&Even Pages"
            Index = 3
            Left   = 390
            Top    = 1380
            Width  = 1245
            Height = 315
            TabIndex = 3
        End
        Begin VB.OptionButton optPageRange
            Caption = "&Odd Pages"
            Index = 2
            Left   = 390
            Top    = 1020
            Width  = 1245
            Height = 315
            TabIndex = 2
        End
        Begin VB.OptionButton optPageRange
            Caption = "&All"
            Index = 0
            Left   = 390
            Top    = 285
            Width  = 1245
            Height = 315
            TabIndex = 0
        End
        Begin VB.OptionButton optPageRange
            Caption = "&Current Page"
            Index = 1
            Left   = 390
            Top    = 645
            Width  = 1245
            Height = 315
            TabIndex = 1
        End
        Begin VB.OptionButton optPageRange
            Caption = "&Pages"
            Index = 4
            Left   = 390
            Top    = 1785
            Width  = 855
            Height = 315
            TabIndex = 4
        End
        Begin VB.TextBox txtPageRange
            Left   = 1320
            Top    = 1785
            Width  = 1725
            Height = 315
            Text = "Text1"
            TabIndex = 5
        End
        Begin VB.Label Label1
            Caption = "Enter either a single page number or a single page range. For example, 5-12"
            Left   = 555
            Top    = 2235
            Width  = 2820
            Height = 480
            TabIndex = 9
        End
    End
    Begin VB.CommandButton cmdOK
        Caption = "Print"
        Left   = 1020
        Top    = 3315
        Width  = 1125
        Height = 345
        TabIndex = 6
        Default = -1              'True
    End
    Begin VB.CommandButton cmdCancel
        Caption = "Cancel"
        Left   = 2310
        Top    = 3315
        Width  = 1125
        Height = 345
        TabIndex = 7
        Cancel = -1              'True
    End
End
