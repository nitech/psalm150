VERSION 5.00
Object = "{831FDD16-0C5C-11D2-A9FC-0000F8754DA1}#2.0#0"; "C:\Program Files (x86)\VBReFormer\Lib\MSCOMCTL.OCX"

Begin VB.UserControl GeneralIndex
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    ClientLeft   = 0
    ClientTop    = 0
    ClientWidth  = 7635
    ClientHeight = 4995
    Begin MSComctlLib.ImageList imgIndex
        OleObjectBlob = GeneralIndex.ctx:0000
        Left = 990
        Top = 600
    End
    Begin MSComctlLib.Toolbar tbrIndex
        Left   = 0
        Top    = 0
        Width  = 5205
        Height = 540
        TabIndex = 0
        OleObjectBlob = GeneralIndex.ctx:0000
        Negotiate = -1              'True
    End
    Begin MSComctlLib.ListView lvwIndex
        Left   = 0
        Top    = 960
        Width  = 5655
        Height = 6135
        TabIndex = 1
        OleObjectBlob = GeneralIndex.ctx:0000
    End
    Begin VB.Label lblSongsFound
        Caption = "Label1"
        Left   = 15
        Top    = 675
        Width  = 495
        Height = 195
        TabIndex = 2
        AutoSize = -1              'True
    End
End
