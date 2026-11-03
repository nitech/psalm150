VERSION 5.00

Begin VB.Form frmConfirm
    Caption = "Confirm Song Replace"
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    BorderStyle = 3
    LinkTopic = "Form1"
    MaxButton = 0              'False
    MinButton = 0              'False
    ControlBox = 0              'False
    ClientLeft   = 5310
    ClientTop    = 7560
    ClientWidth  = 6270
    ClientHeight = 3405
    ShowInTaskbar = 0              'False
    PaletteMode = 1
    Begin VB.CommandButton cmdAction
        Caption = "Cancel"
        Index = 3
        Left   = 4905
        Top    = 2910
        Width  = 1200
        Height = 345
        TabIndex = 3
        Cancel = -1              'True
    End
    Begin VB.CommandButton cmdAction
        Caption = "&No"
        Index = 2
        Left   = 3600
        Top    = 2910
        Width  = 1200
        Height = 345
        TabIndex = 2
    End
    Begin VB.CommandButton cmdAction
        Caption = "Yes To &All"
        Index = 1
        Left   = 2310
        Top    = 2910
        Width  = 1200
        Height = 345
        TabIndex = 1
    End
    Begin VB.CommandButton cmdAction
        Caption = "&Yes"
        Index = 0
        Left   = 1005
        Top    = 2910
        Width  = 1200
        Height = 345
        TabIndex = 0
        Default = -1              'True
    End
    Begin VB.Label lblNewModified
        Caption = "modified"
        Left   = 1770
        Top    = 2430
        Width  = 540
        Height = 195
        TabIndex = 10
        AutoSize = -1              'True
    End
    Begin VB.Image Image3
        Picture = frmConfirm.frx:0000
        Left   = 1125
        Top    = 2190
        Width  = 480
        Height = 480
    End
    Begin VB.Image Image2
        Picture = frmConfirm.frx:031E
        Left   = 1125
        Top    = 1155
        Width  = 480
        Height = 480
    End
    Begin VB.Image Image1
        Picture = frmConfirm.frx:063C
        Left   = 195
        Top    = 210
        Width  = 480
        Height = 480
    End
    Begin VB.Label Label1
        Caption = "with this one?"
        Left   = 1065
        Top    = 1830
        Width  = 2535
        Height = 330
        TabIndex = 9
    End
    Begin VB.Label Label6
        Caption = "Would you like to replace the exisiting song"
        Left   = 1095
        Top    = 825
        Width  = 3060
        Height = 195
        TabIndex = 8
        AutoSize = -1              'True
    End
    Begin VB.Label lblOldModified
        Caption = "modified"
        Left   = 1770
        Top    = 1380
        Width  = 540
        Height = 195
        TabIndex = 7
        AutoSize = -1              'True
    End
    Begin VB.Label lblNewTitle
        Caption = "New Title"
        Left   = 1770
        Top    = 2205
        Width  = 675
        Height = 195
        TabIndex = 6
        AutoSize = -1              'True
    End
    Begin VB.Label lblOldTitle
        Caption = "Song TItle"
        Left   = 1770
        Top    = 1155
        Width  = 690
        Height = 195
        TabIndex = 5
        AutoSize = -1              'True
    End
    Begin VB.Label lblAlert
        Caption = "Alert"
        Left   = 1080
        Top    = 240
        Width  = 315
        Height = 195
        TabIndex = 4
        AutoSize = -1              'True
    End
End
