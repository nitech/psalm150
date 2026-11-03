VERSION 5.00
Object = "{831FDD16-0C5C-11D2-A9FC-0000F8754DA1}#2.0#0"; "C:\Program Files (x86)\VBReFormer\Lib\MSCOMCTL.OCX"

Begin VB.UserControl SongSearch
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    ClientLeft   = 0
    ClientTop    = 0
    ClientWidth  = 6300
    ClientHeight = 5040
    Begin VB.CheckBox chkFullTextSearch
        Caption = "&Full text search"
        Left   = 45
        Top    = 405
        Width  = 1776
        Height = 192
        TabIndex = 3
    End
    Begin VB.CommandButton cmdClear
        Caption = "&Clear"
        Left   = 4275
        Top    = 0
        Width  = 900
        Height = 300
        TabIndex = 2
    End
    Begin VB.CommandButton cmdSearch
        Caption = "&Search"
        Left   = 3270
        Top    = 0
        Width  = 900
        Height = 300
        TabIndex = 1
    End
    Begin VB.TextBox txtSearch
        Left   = 15
        Top    = 0
        Width  = 3135
        Height = 285
        Text = "txtSearch"
        TabIndex = 0
    End
    Begin MSComctlLib.ListView lvwSearch
        Left   = 0
        Top    = 690
        Width  = 5655
        Height = 6135
        TabIndex = 4
        OleObjectBlob = SongSearch.ctx:0000
    End
    Begin VB.Label lblSongsFound
        Caption = "Label1"
        Left   = 2130
        Top    = 405
        Width  = 495
        Height = 195
        TabIndex = 5
        AutoSize = -1              'True
    End
End
