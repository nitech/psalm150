VERSION 5.00
Object = "{F9043C88-F6F2-101A-A3C9-08002B2F49FB}#1.2#0"; "C:\Program Files (x86)\VBReFormer\Lib\COMDLG32.OCX"
Object = "{831FDD16-0C5C-11D2-A9FC-0000F8754DA1}#2.0#0"; "C:\Program Files (x86)\VBReFormer\Lib\MSCOMCTL.OCX"

Begin VB.MDIForm frmMain
    Caption = "MDIForm1"
    BackColor = -2147483636
    WindowState = 2
    Icon = frmMain.frx:0000
    LinkTopic = "MDIForm1"
    ClientLeft   = 165
    ClientTop    = 855
    ClientWidth  = 4680
    ClientHeight = 3195
    Appearance = 0
    StartupPosition = 3
    Begin MSComDlg.CommonDialog CommonDialog1
        OleObjectBlob = frmMain.frx:031E
        Left = 1470
        Top = 1455
    End
    Begin MSComctlLib.Toolbar tbrPreview
        Left   = 0
        Top    = 570
        Width  = 4680
        Height = 630
        TabIndex = 1
        OleObjectBlob = frmMain.frx:031E
        Align = 1
        Begin VB.CommandButton cmdClose
            Caption = "Close"
            Left   = 2880
            Top    = 30
            Width  = 1020
            Height = 330
            TabIndex = 4
            Cancel = -1              'True
        End
        Begin VB.ComboBox cboZoomFactor
            Style = 2
            Left   = 1470
            Top    = 30
            Width  = 885
            Height = 315
            Text = ""
            TabIndex = 3
        End
        Begin VB.TextBox txtCurSheet
            Left   = 435
            Top    = 30
            Width  = 660
            Height = 315
            Text = "Text1"
            TabIndex = 2
        End
    End
    Begin MSComctlLib.Toolbar tbrMain
        Left   = 0
        Top    = 0
        Width  = 4680
        Height = 570
        TabIndex = 0
        OleObjectBlob = frmMain.frx:031E
        Align = 1
    End
    Begin MSComctlLib.ImageList imgToolBar
        OleObjectBlob = frmMain.frx:031E
        Left = 0
        Top = 0
    End
    Begin MSComDlg.CommonDialog cdlMain
        OleObjectBlob = frmMain.frx:031E
        Left = 0
        Top = 0
    End
    Begin VB.Menu mnuFile
        Caption = "&File"
        Begin VB.Menu mnuFileNew
            Caption = "&New..."
            ShortCut = 14
        End
        Begin VB.Menu mnuFileOpen
            Caption = "&Open..."
            ShortCut = 15
        End
        Begin VB.Menu mnuFileSep1
            Caption = "-"
        End
        Begin VB.Menu mnuFilePrint
            Caption = "Print..."
            ShortCut = 16
        End
        Begin VB.Menu mnuFilePrintPreview
            Caption = "Print Pre&view..."
        End
        Begin VB.Menu mnuFilePageSetup
            Caption = "Page Setup..."
        End
        Begin VB.Menu mnuFileMruListSep
            Caption = "-"
        End
        Begin VB.Menu mnuFileMruList
            Index = 0
            Caption = "1"
        End
        Begin VB.Menu mnuFileSep2
            Caption = "-"
        End
        Begin VB.Menu mnuFileExit
            Caption = "E&xit"
        End
    End
    Begin VB.Menu mnuEdit
        Caption = "&Edit"
        Begin VB.Menu mnuEditCategories
            Caption = "Categories..."
        End
    End
    Begin VB.Menu mnuTools
        Caption = "&Tools"
        Begin VB.Menu mnuToolsSlideShow
            Caption = "&Setup Slide Show..."
        End
        Begin VB.Menu mnuToolsCompact
            Caption = "&Compact Song Book..."
        End
        Begin VB.Menu mnuToolsRenumber
            Caption = "&Renumber Songs..."
        End
        Begin VB.Menu mnuToolsSep2
            Caption = "-"
        End
        Begin VB.Menu mnuToolsOptions
            Caption = "&Options..."
        End
    End
    Begin VB.Menu mnuHelp
        Caption = "&Help"
        Begin VB.Menu mnuHelpAbout
            Caption = "About..."
        End
    End
End
