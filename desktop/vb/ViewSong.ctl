VERSION 5.00
Object = "{3B7C8863-D78F-101B-B9B5-04021C009402}#1.2#0"; "C:\Program Files (x86)\VBReFormer\Lib\RICHTX32.OCX"
Object = "{831FDD16-0C5C-11D2-A9FC-0000F8754DA1}#2.0#0"; "C:\Program Files (x86)\VBReFormer\Lib\MSCOMCTL.OCX"

Begin VB.UserControl ViewSong
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    ClientLeft   = 0
    ClientTop    = 0
    ClientWidth  = 4800
    ClientHeight = 3600
    Begin RichTextLib.RichTextBox rtxSong
        Left   = 0
        Top    = 600
        Width  = 1935
        Height = 1935
        TabIndex = 0
        OleObjectBlob = ViewSong.ctx:0000
    End
    Begin MSComctlLib.Toolbar tbrSong
        Left   = 120
        Top    = 0
        Width  = 14940
        Height = 540
        TabIndex = 1
        OleObjectBlob = ViewSong.ctx:0000
    End
    Begin MSComctlLib.ImageList imgSong
        OleObjectBlob = ViewSong.ctx:0000
        Left = 2880
        Top = 780
    End
End
