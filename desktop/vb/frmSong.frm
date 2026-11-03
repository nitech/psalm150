VERSION 5.00

Begin VB.Form frmSong
    Caption = "Form1"
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    Icon = frmSong.frx:0000
    LinkTopic = "Form1"
    ClientLeft   = 60
    ClientTop    = 345
    ClientWidth  = 7935
    ClientHeight = 6930
    StartupPosition = 1
    Begin VB.TextBox txtAuthor
        Left   = 1440
        Top    = 2520
        Width  = 4215
        Height = 315
        Text = "gggggg"
        TabIndex = 3
    End
    Begin VB.ComboBox cboCopyright
        Left   = 1440
        Top    = 2145
        Width  = 4215
        Height = 315
        Text = "cboCopyrightÿ*"
        TabIndex = 2
    End
    Begin VB.TextBox txtBody
        Left   = 1440
        Top    = 2895
        Width  = 4230
        Height = 825
        Text = "Text1"
        TabIndex = 4
        MultiLine = -1              'True
        ScrollBars = 2
    End
    Begin VB.TextBox txtTitle
        Left   = 1440
        Top    = 510
        Width  = 4215
        Height = 285
        Text = "Text1"
        TabIndex = 0
        MaxLength = 50
    End
    Begin VB.TextBox txtSongNum
        Left   = 1440
        Top    = 165
        Width  = 4215
        Height = 285
        Text = "Text1"
        TabIndex = 7
        TabStop = 0              'False
    End
    Begin VB.ComboBox cboCategory
        Style = 2
        Left   = 1440
        Top    = 855
        Width  = 4215
        Height = 315
        Text = ""
        TabIndex = 1
    End
    Begin VB.Frame Frame1
        Left   = 1440
        Top    = 1155
        Width  = 4440
        Height = 930
        TabIndex = 17
        Begin VSB_V1.KeyToolbar tbrKey
            Left   = 60
            Top    = 150
            Width  = 4335
            Height = 735
            TabStop = 0              'False
            TabIndex = 18
            OleObjectBlob = frmSong.frx:031E
        End
    End
    Begin VB.CommandButton cmdSave
        Caption = "Save"
        Left   = 1440
        Top    = 5100
        Width  = 900
        Height = 300
        TabIndex = 5
    End
    Begin VB.CommandButton cmdCancel
        Caption = "Cancel"
        Left   = 2580
        Top    = 5100
        Width  = 900
        Height = 300
        TabIndex = 6
    End
    Begin VB.Label Label4
        Caption = "Key(s):"
        Left   = 135
        Top    = 1380
        Width  = 480
        Height = 195
        TabIndex = 16
        AutoSize = -1              'True
        BackStyle = 0
    End
    Begin VB.Label Label7
        Caption = "Category:"
        Left   = 90
        Top    = 960
        Width  = 675
        Height = 195
        TabIndex = 15
        AutoSize = -1              'True
        BackStyle = 0
    End
    Begin VB.Label Label1
        Caption = "Author:"
        Left   = 120
        Top    = 2580
        Width  = 510
        Height = 195
        TabIndex = 14
        AutoSize = -1              'True
        BackStyle = 0
    End
    Begin VB.Label Label2
        Caption = "Title:"
        Left   = 120
        Top    = 570
        Width  = 345
        Height = 195
        TabIndex = 13
        AutoSize = -1              'True
        BackStyle = 0
    End
    Begin VB.Label Label5
        Caption = "Copyright:"
        Left   = 120
        Top    = 2160
        Width  = 705
        Height = 195
        TabIndex = 12
        AutoSize = -1              'True
        BackStyle = 0
    End
    Begin VB.Label Label6
        Caption = "Verses / Chorus:"
        Left   = 120
        Top    = 2940
        Width  = 1185
        Height = 195
        TabIndex = 11
        AutoSize = -1              'True
        BackStyle = 0
    End
    Begin VB.Label lblSongNum
        Caption = "Song #:"
        Left   = 120
        Top    = 210
        Width  = 570
        Height = 195
        TabIndex = 10
        AutoSize = -1              'True
        BackStyle = 0
    End
    Begin VB.Label lblModifiedOnCaption
        Caption = "Last Updated On:"
        Left   = 90
        Top    = 4710
        Width  = 1260
        Height = 195
        TabIndex = 9
        AutoSize = -1              'True
        BackStyle = 0
    End
    Begin VB.Label lblModifiedOnDate
        Caption = "Last Updated On:"
        Left   = 1440
        Top    = 4710
        Width  = 1260
        Height = 195
        TabIndex = 8
        AutoSize = -1              'True
        BackStyle = 0
    End
End
