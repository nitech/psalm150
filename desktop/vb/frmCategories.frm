VERSION 5.00

Begin VB.Form frmCategories
    Caption = "Categories"
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    BorderStyle = 3
    LinkTopic = "Form1"
    MaxButton = 0              'False
    MinButton = 0              'False
    ClientLeft   = 2760
    ClientTop    = 3750
    ClientWidth  = 4665
    ClientHeight = 5580
    ShowInTaskbar = 0              'False
    StartupPosition = 1
    Begin VB.CommandButton cmdSave
        Caption = "Create"
        Left   = 3420
        Top    = 360
        Width  = 1005
        Height = 345
        TabIndex = 7
    End
    Begin VB.CommandButton cmdDelete
        Caption = "Delete"
        Left   = 3450
        Top    = 1770
        Width  = 1005
        Height = 345
        TabIndex = 6
    End
    Begin VB.ListBox lstCategories
        Left   = 180
        Top    = 1350
        Width  = 3165
        Height = 3960
        TabIndex = 2
        Sorted = -1              'True
    End
    Begin VB.TextBox txtCategory
        Left   = 180
        Top    = 360
        Width  = 3165
        Height = 315
        Text = "Text1"
        TabIndex = 0
    End
    Begin VB.CommandButton cmdClose
        Caption = "Close"
        Left   = 3450
        Top    = 4980
        Width  = 1005
        Height = 345
        TabIndex = 3
        Cancel = -1              'True
    End
    Begin VB.CommandButton cmdNew
        Caption = "New"
        Left   = 3450
        Top    = 1350
        Width  = 1005
        Height = 345
        TabIndex = 1
    End
    Begin VB.Label lblCategory
        Caption = "Category:"
        Left   = 210
        Top    = 120
        Width  = 675
        Height = 195
        TabIndex = 5
        AutoSize = -1              'True
    End
    Begin VB.Label Label1
        Caption = "Existing Categories:"
        Left   = 210
        Top    = 1110
        Width  = 1380
        Height = 195
        TabIndex = 4
        AutoSize = -1              'True
    End
End
