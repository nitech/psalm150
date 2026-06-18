VERSION 5.00
Object = "{831FDD16-0C5C-11D2-A9FC-0000F8754DA1}#2.0#0"; "C:\Program Files (x86)\VBReFormer\Lib\MSCOMCTL.OCX"

Begin VB.UserControl KeyIndex
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    ClientLeft   = 0
    ClientTop    = 0
    ClientWidth  = 5190
    ClientHeight = 4110
    Begin VSB_V1.KeyToolbar tbrIndex
        Left   = 0
        Top    = 0
        Width  = 4740
        Height = 720
        TabIndex = 0
        OleObjectBlob = KeyIndex.ctx:0000
    End
    Begin MSComctlLib.ListView lvwIndex
        Left   = 105
        Top    = 1065
        Width  = 5655
        Height = 6135
        TabIndex = 1
        OleObjectBlob = KeyIndex.ctx:0000
    End
    Begin VB.Label lblSongsFound
        Caption = "Label1"
        Left   = 15
        Top    = 780
        Width  = 495
        Height = 195
        TabIndex = 2
        AutoSize = -1              'True
    End
End
