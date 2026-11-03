VERSION 5.00
Object = "{831FDD16-0C5C-11D2-A9FC-0000F8754DA1}#2.0#0"; "C:\Program Files (x86)\VBReFormer\Lib\MSCOMCTL.OCX"

Begin VB.UserControl History
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    ClientLeft   = 0
    ClientTop    = 0
    ClientWidth  = 4800
    ClientHeight = 3600
    Begin MSComctlLib.TreeView tvwHistory
        Left   = 720
        Top    = 120
        Width  = 2775
        Height = 1455
        TabIndex = 0
        OleObjectBlob = History.ctx:0000
    End
    Begin MSComctlLib.ImageList imgHistory
        OleObjectBlob = History.ctx:0000
        Left = 0
        Top = 0
    End
End
