VERSION 5.00
Object = "{54FC599E-9611-11D2-8350-E97AACC90D73}#1.1#0"; "C:\WINDOWS\SysWow64\SpltrBar.ocx"
Object = "{831FDD16-0C5C-11D2-A9FC-0000F8754DA1}#2.0#0"; "C:\Program Files (x86)\VBReFormer\Lib\MSCOMCTL.OCX"

Begin VB.Form frmSongbook
    Caption = "Visual Song Book"
    WindowState = 2
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    FillColor = 8421504
    Icon = frmSongbook.frx:0000
    LinkTopic = "Form1"
    MDIChild = -1              'True
    KeyPreview = -1              'True
    ClientLeft   = 5685
    ClientTop    = 1395
    ClientWidth  = 15180
    ClientHeight = 10680
    PaletteMode = 1
    Begin VSB_V1.ViewSong objViewSong
        Left   = 11130
        Top    = 6435
        Width  = 2910
        Height = 3435
        TabIndex = 6
        OleObjectBlob = frmSongbook.frx:031E
    End
    Begin VSB_V1.GeneralIndex objGenIndex
        Left   = 795
        Top    = 3735
        Width  = 4710
        Height = 2145
        TabIndex = 5
        OleObjectBlob = frmSongbook.frx:031E
    End
    Begin VSB_V1.SongSearch objSearch
        Left   = 450
        Top    = 450
        Width  = 5175
        Height = 2745
        TabIndex = 4
        OleObjectBlob = frmSongbook.frx:031E
    End
    Begin VSB_V1.History objHistory
        Left   = 7155
        Top    = 4005
        Width  = 6135
        Height = 1410
        TabIndex = 3
        OleObjectBlob = frmSongbook.frx:031E
    End
    Begin VSB_V1.KeyIndex objKeyIndex
        Left   = 7110
        Top    = 270
        Width  = 6165
        Height = 3480
        TabIndex = 2
        OleObjectBlob = frmSongbook.frx:031E
    End
    Begin SplitterBars.VSplitterBar VSplitterBar1
        Left   = 6390
        Top    = 1980
        Width  = 135
        Height = 6435
        OleObjectBlob = frmSongbook.frx:031E
    End
    Begin MSComctlLib.TabStrip tabRight
        Left   = 7110
        Top    = 6240
        Width  = 3255
        Height = 3375
        TabIndex = 0
        OleObjectBlob = frmSongbook.frx:031E
    End
    Begin MSComctlLib.TabStrip tabLeft
        Left   = 1230
        Top    = 6270
        Width  = 3255
        Height = 3375
        TabIndex = 1
        OleObjectBlob = frmSongbook.frx:031E
    End
End
