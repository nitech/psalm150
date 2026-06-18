VERSION 5.00
Object = "{FE0065C0-1B7B-11CF-9D53-00AA003C9CB6}#1.1#0"; "C:\WINDOWS\SysWow64\COMCT232.OCX"
Object = "{6B7E6392-850A-101B-AFC0-4210102A8DA7}#1.3#0"; "C:\WINDOWS\SysWow64\COMCTL32.OCX"

Begin VB.Form frmPageSetup
    Caption = "Page Setup"
    ScaleMode = 1
    AutoRedraw = 0              'False
    FontTransparent = -1              'True
    BorderStyle = 3
    Icon = frmPageSetup.frx:0000
    LinkTopic = "Form1"
    MaxButton = 0              'False
    MinButton = 0              'False
    KeyPreview = -1              'True
    ClientLeft   = 45
    ClientTop    = 330
    ClientWidth  = 9030
    ClientHeight = 3285
    StartupPosition = 1
    Begin VB.Frame Frame3
        Caption = "Printing Options"
        Left   = 270
        Top    = 600
        Width  = 2760
        Height = 1905
        TabIndex = 29
        Begin VB.ComboBox cboLayout
            Style = 2
            Left   = 1095
            Top    = 690
            Width  = 1500
            Height = 315
            Text = ""
            TabIndex = 1
        End
        Begin VB.ComboBox cboOrientation
            Style = 2
            Left   = 1095
            Top    = 330
            Width  = 1500
            Height = 315
            Text = ""
            TabIndex = 0
        End
        Begin VB.Label Label8
            Caption = "&Layout:"
            Left   = 195
            Top    = 765
            Width  = 795
            Height = 225
            TabIndex = 33
            BackStyle = 0
        End
        Begin VB.Label Label4
            Caption = "&Orientation:"
            Left   = 195
            Top    = 390
            Width  = 795
            Height = 225
            TabIndex = 32
            BackStyle = 0
        End
        Begin VB.Label lblDuplexRequired
            Caption = "Requires you to enable your printer's duplex printing feature"
            Left   = 420
            Top    = 1245
            Width  = 2160
            Height = 465
            TabIndex = 31
        End
        Begin VB.Label lblDuplexRequiredAsterisk
            Caption = "*"
            Left   = 300
            Top    = 1245
            Width  = 60
            Height = 195
            TabIndex = 30
            AutoSize = -1              'True
        End
    End
    Begin VB.Frame Frame2
        Caption = "Columns"
        Left   = 5835
        Top    = 600
        Width  = 2895
        Height = 1905
        TabIndex = 25
        Begin VB.TextBox txtField
            Index = 5
            Left   = 1620
            Top    = 1050
            Width  = 720
            Height = 285
            Text = "1"""
            TabIndex = 8
        End
        Begin VB.TextBox txtField
            Index = 4
            Left   = 1620
            Top    = 690
            Width  = 720
            Height = 285
            Text = "1"""
            TabIndex = 7
        End
        Begin VB.CheckBox chkLineBetween
            Caption = "Line &between columns"
            Left   = 555
            Top    = 1440
            Width  = 1995
            Height = 270
            TabIndex = 9
        End
        Begin VB.ComboBox cboColumnCount
            Style = 2
            Left   = 1620
            Top    = 330
            Width  = 855
            Height = 315
            Text = ""
            TabIndex = 6
        End
        Begin ComCtl2.UpDown updField
            Index = 5
            Left   = 2370
            Top    = 1050
            Width  = 240
            Height = 285
            TabStop = 0              'False
            TabIndex = 18
            OleObjectBlob = frmPageSetup.frx:031E
        End
        Begin ComCtl2.UpDown updField
            Index = 4
            Left   = 2370
            Top    = 690
            Width  = 240
            Height = 285
            TabStop = 0              'False
            TabIndex = 17
            OleObjectBlob = frmPageSetup.frx:031E
        End
        Begin VB.Label Label2
            Caption = "Column &spacing:"
            Left   = 210
            Top    = 1080
            Width  = 1245
            Height = 225
            TabIndex = 28
            BackStyle = 0
        End
        Begin VB.Label Label1
            Caption = "Column &width:"
            Left   = 210
            Top    = 750
            Width  = 1245
            Height = 225
            TabIndex = 27
            BackStyle = 0
        End
        Begin VB.Label Label3
            Caption = "&Columns per page:"
            Left   = 210
            Top    = 390
            Width  = 1395
            Height = 225
            TabIndex = 26
            BackStyle = 0
        End
    End
    Begin VB.Frame Frame1
        Caption = "Margins"
        Left   = 3135
        Top    = 600
        Width  = 2595
        Height = 1905
        TabIndex = 20
        Begin VB.TextBox txtField
            Index = 0
            Left   = 1245
            Top    = 330
            Width  = 720
            Height = 285
            Text = "1"""
            TabIndex = 2
        End
        Begin VB.TextBox txtField
            Index = 1
            Left   = 1245
            Top    = 690
            Width  = 720
            Height = 285
            Text = "1"""
            TabIndex = 3
        End
        Begin VB.TextBox txtField
            Index = 2
            Left   = 1245
            Top    = 1050
            Width  = 720
            Height = 285
            Text = "1"""
            TabIndex = 4
        End
        Begin VB.TextBox txtField
            Index = 3
            Left   = 1245
            Top    = 1410
            Width  = 720
            Height = 285
            Text = "1"""
            TabIndex = 5
        End
        Begin ComCtl2.UpDown updField
            Index = 0
            Left   = 1980
            Top    = 330
            Width  = 240
            Height = 300
            TabStop = 0              'False
            TabIndex = 13
            OleObjectBlob = frmPageSetup.frx:031E
        End
        Begin ComCtl2.UpDown updField
            Index = 1
            Left   = 1980
            Top    = 690
            Width  = 240
            Height = 300
            TabStop = 0              'False
            TabIndex = 14
            OleObjectBlob = frmPageSetup.frx:031E
        End
        Begin ComCtl2.UpDown updField
            Index = 2
            Left   = 1980
            Top    = 1050
            Width  = 240
            Height = 300
            TabStop = 0              'False
            TabIndex = 15
            OleObjectBlob = frmPageSetup.frx:031E
        End
        Begin ComCtl2.UpDown updField
            Index = 3
            Left   = 1980
            Top    = 1410
            Width  = 240
            Height = 300
            TabStop = 0              'False
            TabIndex = 16
            OleObjectBlob = frmPageSetup.frx:031E
        End
        Begin VB.Label lblMargin
            Caption = "&Top:"
            Index = 0
            Left   = 300
            Top    = 390
            Width  = 660
            Height = 210
            TabIndex = 24
            BackStyle = 0
        End
        Begin VB.Label lblMargin
            Caption = "Ri&ght:"
            Index = 3
            Left   = 300
            Top    = 1470
            Width  = 660
            Height = 210
            TabIndex = 23
            BackStyle = 0
        End
        Begin VB.Label lblMargin
            Caption = "Le&ft:"
            Index = 2
            Left   = 300
            Top    = 1110
            Width  = 660
            Height = 210
            TabIndex = 22
            BackStyle = 0
        End
        Begin VB.Label lblMargin
            Caption = "&Bottom:"
            Index = 1
            Left   = 300
            Top    = 750
            Width  = 660
            Height = 210
            TabIndex = 21
            BackStyle = 0
        End
    End
    Begin VB.CommandButton cmdCancel
        Caption = "Cancel"
        Left   = 7305
        Top    = 2865
        Width  = 1125
        Height = 345
        TabIndex = 11
        Cancel = -1              'True
    End
    Begin VB.CommandButton cmdOK
        Caption = "OK"
        Left   = 6045
        Top    = 2865
        Width  = 1125
        Height = 345
        TabIndex = 10
        Default = -1              'True
    End
    Begin VB.CommandButton cmdAdvanced
        Caption = "Advanced..."
        Left   = 60
        Top    = 2865
        Width  = 1125
        Height = 345
        TabIndex = 12
    End
    Begin ComctlLib.TabStrip tabPageSetup
        Left   = 90
        Top    = 120
        Width  = 8805
        Height = 2610
        TabIndex = 19
        OleObjectBlob = frmPageSetup.frx:031E
    End
End
