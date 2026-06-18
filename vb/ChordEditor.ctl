VERSION 5.00
Object = "{5B033ECF-098E-11D1-A4B2-444553540000}#1.0#0"; "C:\WINDOWS\SysWow64\Subclass.ocx"

Begin VB.UserControl ChordEditor
    ScaleMode = 3
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    FillColor = -2147483643
    KeyPreview = -1              'True
    ClientLeft   = 0
    ClientTop    = 0
    ClientWidth  = 3855
    ClientHeight = 3180
    BorderStyle = 1
    Begin SubclassCtl.Subclass Subclass2
        OleObjectBlob = ChordEditor.ctx:0000
        Left = 2520
        Top = 1920
    End
    Begin SubclassCtl.Subclass Subclass1
        OleObjectBlob = ChordEditor.ctx:0000
        Left = 2520
        Top = 1080
    End
    Begin VB.PictureBox picWindow
        BackColor = -2147483643
        ForeColor = -2147483640
        Left   = -960
        Top    = -960
        Width  = 3015
        Height = 2655
        TabIndex = 2
        ScaleMode = 1
        AutoRedraw = 0              'False
        FontTransparent = -1              'True
        BorderStyle = 0
        TabStop = 0              'False
        Appearance = 0
    End
    Begin VB.HScrollBar HScroll
        Left   = 0
        Top    = 2880
        Width  = 3495
        Height = 255
        Enabled = 0              'False
        TabIndex = 1
    End
    Begin VB.VScrollBar VScroll
        Left   = 3480
        Top    = 0
        Width  = 375
        Height = 2775
        TabIndex = 0
    End
End
