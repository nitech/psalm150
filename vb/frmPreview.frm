VERSION 5.00

Begin VB.Form frmPreview
    Caption = "Form2"
    BackColor = -2147483636
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    BorderStyle = 0
    LinkTopic = "Form2"
    MDIChild = -1              'True
    KeyPreview = -1              'True
    ClientLeft   = 0
    ClientTop    = 0
    ClientWidth  = 6345
    ClientHeight = 4770
    ShowInTaskbar = 0              'False
    Begin VB.PictureBox picPaper
        BackColor = -2147483643
        ForeColor = -2147483640
        Left   = 300
        Top    = 240
        Width  = 2985
        Height = 2925
        TabIndex = 0
        ScaleMode = 1
        AutoRedraw = 0              'False
        FontTransparent = -1              'True
        Appearance = 0
    End
    Begin VB.Line linHorzShadow
        BorderColor = -2147483627
        X1 = 1260
        Y1 = 3900
        X2 = 4200
        Y2 = 3900
        BorderWidth = 2
    End
    Begin VB.Line linVertShadow
        BorderColor = -2147483627
        X1 = 4500
        Y1 = 930
        X2 = 4500
        Y2 = 3900
        BorderWidth = 2
    End
End
