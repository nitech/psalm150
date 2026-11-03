VERSION 5.00
Object = "{DC8AD394-6800-11D0-A751-00A0C91110C3}#7.0#0"; "C:\WINDOWS\SysWow64\VerseList.ocx"

Begin VB.Form frmPresenter
    Caption = "lj"
    BackColor = 0
    ForeColor = 16776960
    WindowState = 2
    ScaleMode = 3
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    FillColor = 16777215
    BorderStyle = 0
    Icon = frmPresenter.frx:0000
    LinkTopic = "Form1"
    MaxButton = 0              'False
    MinButton = 0              'False
    ControlBox = 0              'False
    KeyPreview = -1              'True
    ClientLeft   = 3600
    ClientTop    = 3780
    ClientWidth  = 8625
    ClientHeight = 11520
    ShowInTaskbar = 0              'False
    PaletteMode = 1
    Begin VB.PictureBox picShow
        BackColor = 16777215
        ForeColor = -2147483640
        Left   = 0
        Top    = 0
        Width  = 5745
        Height = 5055
        TabIndex = 1
        ScaleMode = 3
        AutoRedraw = 0              'False
        FontTransparent = -1              'True
        BorderStyle = 0
        Appearance = 0
        Begin VSB_V1.VSBShow VSBShow1
            Left   = 645
            Top    = 495
            Width  = 4275
            Height = 3555
            OleObjectBlob = frmPresenter.frx:031E
        End
    End
    Begin ODVerseList.VerseList VerseList1
        Left   = 6060
        Top    = 180
        Width  = 2325
        Height = 2775
        TabStop = 0              'False
        TabIndex = 0
        OleObjectBlob = frmPresenter.frx:031E
    End
End
