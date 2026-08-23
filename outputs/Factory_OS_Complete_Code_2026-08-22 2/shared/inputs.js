/* Factory OS — reference data.
   REAL (from the client's BOM compilation): articles, combos, material rates, packing chart.
   PLACEHOLDER — replace with the client's real figures: every "stock" value and every
   "capacity_per_day". Prices are per-article and entered on the PI, not stored here.
   Pretty-printed so it is diffable and hand-editable; move to database tables when ready. */
export const INPUTS = {
  "origin": "2026-07-06",
  "articles": {
    "ARMOUR (VELCRO)": {
      "sole_type": "EVA",
      "sole_assumed": false,
      "combo_order": [
        "8X10",
        "11X1",
        "2X5",
        "6X10B"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "8X10": {
          "stitching_combo": "8X10",
          "rates": {
            "CUTTING": {
              "ARMOR REXION||MTR": 0.077407,
              "TOE PUFF 0.8MM||SHEET": 0.005952,
              "PU MESH (HARD FOAM+BACKER)||MTR": 0.053562,
              "VAMP ASTER DOUBLE BACKER||MTR": 0.017391,
              "SKINFIT GOLA ( FOAM + BACKER)||MTR": 0.055067,
              "DRILL CLOTH||MTR": 0.009556,
              "ASTER HEAVY FOR TOUNG||MTR": 0.012012,
              "COLOR FOAM 20MM||SHEET": 0.009091,
              "TEXION||SHEET": 0.023202,
              "STIFNER 1.4MM YELLOW||SHEET": 0.006144,
              "INSOLE 4 MM||MTR": 0.017902
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 0.037333,
              "SIZE LABEL||PCS": 2,
              "TOUNG LABEL SNEAKER||PCS": 2,
              "PF-48||PCS": 4,
              "VELCRO 20 MM HOOK||MTR": 0.28,
              "VELCRO 20 MM LOOP||MTR": 0.28,
              "POLYESTER BINDING 12 MM||MTR": 0.28,
              "BACK TAPE 14 MM||MTR": 0.08
            }
          }
        },
        "11X1": {
          "stitching_combo": "11X1",
          "rates": {
            "CUTTING": {
              "ARMOR REXION||MTR": 0.088889,
              "TOE PUFF 0.8MM||SHEET": 0.007491,
              "PU MESH (HARD FOAM+BACKER)||MTR": 0.06402,
              "VAMP ASTER DOUBLE BACKER||MTR": 0.020619,
              "SKINFIT GOLA ( FOAM + BACKER)||MTR": 0.064533,
              "DRILL CLOTH||MTR": 0.011852,
              "ASTER HEAVY FOR TOUNG||MTR": 0.013889,
              "COLOR FOAM 20MM||SHEET": 0.009818,
              "TEXION||SHEET": 0.027778,
              "STIFNER 1.4MM YELLOW||SHEET": 0.008547,
              "INSOLE 4 MM||MTR": 0.022222
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 0.040667,
              "SIZE LABEL||PCS": 2,
              "TOUNG LABEL SNEAKER||PCS": 2,
              "PF-48||PCS": 4,
              "VELCRO 20 MM HOOK||MTR": 0.3,
              "VELCRO 20 MM LOOP||MTR": 0.3,
              "POLYESTER BINDING 12 MM||MTR": 0.3,
              "BACK TAPE 14 MM||MTR": 0.08
            }
          }
        },
        "2X5": {
          "stitching_combo": "2X5",
          "rates": {
            "CUTTING": {
              "ARMOR REXION||MTR": 0.106,
              "TOE PUFF 0.8MM||SHEET": 0.008643,
              "PU MESH (HARD FOAM+BACKER)||MTR": 0.088889,
              "VAMP ASTER DOUBLE BACKER||MTR": 0.023375,
              "SKINFIT GOLA ( FOAM + BACKER)||MTR": 0.0732,
              "DRILL CLOTH||MTR": 0.013852,
              "ASTER HEAVY FOR TOUNG||MTR": 0.017316,
              "COLOR FOAM 20MM||SHEET": 0.010582,
              "TEXION||SHEET": 0.034002,
              "STIFNER 1.4MM YELLOW||SHEET": 0.00912,
              "INSOLE 4 MM||MTR": 0.028986
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 0.043333,
              "SIZE LABEL||PCS": 2,
              "TOUNG LABEL SNEAKER||PCS": 2,
              "PF-48||PCS": 4,
              "VELCRO 20 MM HOOK||MTR": 0.37,
              "VELCRO 20 MM LOOP||MTR": 0.37,
              "POLYESTER BINDING 12 MM||MTR": 0.32,
              "BACK TAPE 14 MM||MTR": 0.1
            }
          }
        },
        "6X10B": {
          "stitching_combo": "6X10B",
          "rates": {
            "CUTTING": {
              "ARMOR REXION||MTR": 0.124444,
              "TOE PUFF 0.8MM||SHEET": 0.008985,
              "PU MESH (HARD FOAM+BACKER)||MTR": 0.103704,
              "VAMP ASTER DOUBLE BACKER||MTR": 0.028736,
              "SKINFIT GOLA ( FOAM + BACKER)||MTR": 0.081867,
              "DRILL CLOTH||MTR": 0.016296,
              "ASTER HEAVY FOR TOUNG||MTR": 0.01955,
              "COLOR FOAM 20MM||SHEET": 0.014035,
              "TEXION||SHEET": 0.045455,
              "STIFNER 1.4MM YELLOW||SHEET": 0.009804,
              "INSOLE 4 MM||MTR": 0.035714
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 0.048,
              "SIZE LABEL||PCS": 2,
              "TOUNG LABEL SNEAKER||PCS": 2,
              "PF-3||PCS": 4,
              "VELCRO 20 MM HOOK||MTR": 0.02,
              "VELCRO 20 MM LOOP||MTR": 0.02,
              "VELCRO 25 MM HOOK||MTR": 0.4,
              "VELCRO 25 MM LOOP||MTR": 0.4,
              "POLYESTER BINDING 12 MM||MTR": 0.34,
              "BACK TAPE 14 MM||MTR": 0.12
            }
          }
        }
      }
    },
    "ARMOUR (LACE)": {
      "sole_type": "EVA",
      "sole_assumed": false,
      "combo_order": [
        "8X10",
        "11X1",
        "2X5",
        "6X10B"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "8X10": {
          "stitching_combo": "8X10",
          "rates": {
            "CUTTING": {
              "ARMOR REXION||MTR": 0.077407,
              "TOE PUFF 0.8MM||SHEET": 0.012667,
              "PU MESH (HARD FOAM+BACKER)||MTR": 0.053562,
              "VAMP ASTER DOUBLE BACKER||MTR": 0.017391,
              "SKINFIT GOLA ( FOAM + BACKER)||MTR": 0.055067,
              "DRILL CLOTH||MTR": 0.009556,
              "ASTER HEAVY FOR TOUNG||MTR": 0.012012,
              "COLOR FOAM 20MM||SHEET": 0.009091,
              "TEXION||SHEET": 0.023202,
              "STIFNER 1.4MM YELLOW||SHEET": 0.006144,
              "INSOLE 4 MM||MTR": 0.017902
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 0.034,
              "SIZE LABEL||PCS": 2,
              "TOUNG LABEL SNEAKER||PCS": 2,
              "POLYESTER BINDING 12 MM||MTR": 0.28,
              "BACK TAPE 14 MM||MTR": 0.08
            }
          }
        },
        "11X1": {
          "stitching_combo": "11X1",
          "rates": {
            "CUTTING": {
              "ARMOR REXION||MTR": 0.07837,
              "TOE PUFF 0.8MM||SHEET": 0.015467,
              "PU MESH (HARD FOAM+BACKER)||MTR": 0.06402,
              "VAMP ASTER DOUBLE BACKER||MTR": 0.020619,
              "SKINFIT GOLA ( FOAM + BACKER)||MTR": 0.064533,
              "DRILL CLOTH||MTR": 0.011852,
              "ASTER HEAVY FOR TOUNG||MTR": 0.013889,
              "COLOR FOAM 20MM||SHEET": 0.009818,
              "TEXION||SHEET": 0.027778,
              "STIFNER 1.4MM YELLOW||SHEET": 0.008547,
              "INSOLE 4 MM||MTR": 0.022222
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 0.037333,
              "SIZE LABEL||PCS": 2,
              "TOUNG LABEL SNEAKER||PCS": 2,
              "POLYESTER BINDING 12 MM||MTR": 0.3,
              "BACK TAPE 14 MM||MTR": 0.08
            }
          }
        },
        "2X5": {
          "stitching_combo": "2X5",
          "rates": {
            "CUTTING": {
              "ARMOR REXION||MTR": 0.094074,
              "TOE PUFF 0.8MM||SHEET": 0.018667,
              "PU MESH (HARD FOAM+BACKER)||MTR": 0.088889,
              "VAMP ASTER DOUBLE BACKER||MTR": 0.023375,
              "SKINFIT GOLA ( FOAM + BACKER)||MTR": 0.0732,
              "DRILL CLOTH||MTR": 0.013852,
              "ASTER HEAVY FOR TOUNG||MTR": 0.017316,
              "COLOR FOAM 20MM||SHEET": 0.010582,
              "TEXION||SHEET": 0.034002,
              "STIFNER 1.4MM YELLOW||SHEET": 0.00912,
              "INSOLE 4 MM||MTR": 0.028986
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 0.04,
              "SIZE LABEL||PCS": 2,
              "TOUNG LABEL SNEAKER||PCS": 2,
              "POLYESTER BINDING 12 MM||MTR": 0.32,
              "BACK TAPE 14 MM||MTR": 0.1
            }
          }
        },
        "6X10B": {
          "stitching_combo": "6X10B",
          "rates": {
            "CUTTING": {
              "ARMOR REXION||MTR": 0.108667,
              "TOE PUFF 0.8MM||SHEET": 0.021467,
              "PU MESH (HARD FOAM+BACKER)||MTR": 0.103704,
              "VAMP ASTER DOUBLE BACKER||MTR": 0.028736,
              "SKINFIT GOLA ( FOAM + BACKER)||MTR": 0.081867,
              "DRILL CLOTH||MTR": 0.016296,
              "ASTER HEAVY FOR TOUNG||MTR": 0.01955,
              "COLOR FOAM 20MM||SHEET": 0.014035,
              "TEXION||SHEET": 0.045455,
              "STIFNER 1.4MM YELLOW||SHEET": 0.009804,
              "INSOLE 4 MM||MTR": 0.035714
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 0.045333,
              "SIZE LABEL||PCS": 2,
              "TOUNG LABEL SNEAKER||PCS": 2,
              "POLYESTER BINDING 12 MM||MTR": 0.34,
              "BACK TAPE 14 MM||MTR": 0.12
            }
          }
        }
      }
    },
    "REX GOLA (V)": {
      "sole_type": "PVC",
      "sole_assumed": false,
      "combo_order": [
        "8X10",
        "11X13",
        "1X3",
        "4X5",
        "6X7B",
        "8X10B"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "8X10": {
          "stitching_combo": "8X10",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.057185,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.05,
              "REXION 1.5MM FOR INTOE||MTR": 0.013926,
              "REXION 0.8MM FOR EYELET PATTI||MTR": 0.00837,
              "STIFFNER 1.4 MM||SHEET": 0.0104,
              "SKIN FIT 5 MM||MTR": 0.0526,
              "FOAM 10 MM||SHEET": 0.011333,
              "FOAM 20 MM||SHEET": 0.0102,
              "ASTAR 3 MM Heavy||MTR": 0.017867,
              "INSOLE 4 MM||MTR": 0.016,
              "R.||MTR": 0.019259
            },
            "STITCHING": {
              "Nylon Thread 3 Ply||CONE": 0.027667,
              "Polister Binding 12mm||MTR": 0.32,
              "Lebel Gola||MTR": 2,
              "Velcro 20mm Hook||MTR": 0.3,
              "Velcro 20mm Loop||MTR": 0.3,
              "Buckle PF-48||PCS": 4,
              "PP Bag 18.5x31||PCS": 0.066667
            }
          }
        },
        "11X13": {
          "stitching_combo": "11X13",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.065037,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.052667,
              "REXION 1.5MM FOR INTOE||MTR": 0.015185,
              "REXION 0.8MM FOR EYELET PATTI||MTR": 0.00963,
              "STIFFNER 1.4 MM||SHEET": 0.0122,
              "SKIN FIT 5 MM||MTR": 0.055533,
              "FOAM 10 MM||SHEET": 0.014267,
              "FOAM 20 MM||SHEET": 0.0102,
              "ASTAR 3 MM Heavy||MTR": 0.0222,
              "INSOLE 4 MM||MTR": 0.019586,
              "R.||MTR": 0.023778
            },
            "STITCHING": {
              "Nylon Thread 3 Ply||CONE": 0.031,
              "Polister Binding 12mm||MTR": 0.36,
              "Lebel Gola||MTR": 2,
              "Velcro 20mm Hook||MTR": 0.32,
              "Velcro 20mm Loop||MTR": 0.32,
              "Buckle PF-48||PCS": 4,
              "PP Bag 18.5x31||PCS": 0.066667
            }
          }
        },
        "1X3": {
          "stitching_combo": "1X5",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.072593,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.066667,
              "REXION 1.5MM FOR INTOE||MTR": 0.016667,
              "REXION 0.8MM FOR EYELET PATTI||MTR": 0.011481,
              "STIFFNER 1.4 MM||SHEET": 0.013867,
              "SKIN FIT 5 MM||MTR": 0.076933,
              "FOAM 10 MM||SHEET": 0.018533,
              "FOAM 20 MM||SHEET": 0.013133,
              "ASTAR 3 MM light||MTR": 0.011133,
              "ASTAR 3 MM Heavy||MTR": 0.026333,
              "INSOLE 4 MM||MTR": 0.02269,
              "R.||MTR": 0.030296
            },
            "STITCHING": {
              "Nylon Thread 3 Ply||CONE": 0.033667,
              "Polister Binding 12mm||MTR": 0.38,
              "Lebel Gola||MTR": 2,
              "Velcro 20mm Hook||MTR": 0.35,
              "Velcro 20mm Loop||MTR": 0.35,
              "Buckle PF-48||PCS": 4,
              "PP Bag 18.5x31||PCS": 0.066667
            }
          }
        },
        "4X5": {
          "stitching_combo": "1X5",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.080667,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.074074,
              "REXION 1.5MM FOR INTOE||MTR": 0.02,
              "REXION 0.8MM FOR EYELET PATTI||MTR": 0.011259,
              "STIFFNER 1.4 MM||SHEET": 0.015133,
              "SKIN FIT 5 MM||MTR": 0.083333,
              "FOAM 10 MM||SHEET": 0.018533,
              "FOAM 20 MM||SHEET": 0.013133,
              "ASTAR 3 MM light||MTR": 0.013533,
              "ASTAR 3 MM Heavy||MTR": 0.026333,
              "INSOLE 4 MM||MTR": 0.025034,
              "R.||MTR": 0.030296
            },
            "STITCHING": {
              "Nylon Thread 3 Ply||CONE": 0.033667,
              "Polister Binding 12mm||MTR": 0.38,
              "Lebel Gola||MTR": 2,
              "Velcro 20mm Hook||MTR": 0.35,
              "Velcro 20mm Loop||MTR": 0.35,
              "Buckle PF-48||PCS": 4,
              "PP Bag 18.5x31||PCS": 0.066667
            }
          }
        },
        "6X7B": {
          "stitching_combo": "6X7B",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.087556,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.077037,
              "REXION 1.5MM FOR INTOE||MTR": 0.026296,
              "REXION 0.8MM FOR EYELET PATTI||MTR": 0.01037,
              "STIFFNER 1.4 MM||SHEET": 0.017067,
              "SKIN FIT 5 MM||MTR": 0.083333,
              "FOAM 10 MM||SHEET": 0.021733,
              "FOAM 20 MM||SHEET": 0.0156,
              "ASTAR 3 MM light||MTR": 0.015133,
              "ASTAR 3 MM Heavy||MTR": 0.033333,
              "INSOLE 4 MM||MTR": 0.031241,
              "R.||MTR": 0.04
            },
            "STITCHING": {
              "Nylon Thread 3 Ply||CONE": 0.034667,
              "Polister Binding 12mm||MTR": 0.38,
              "Lebel Gola||MTR": 2,
              "PP Bag 18.5x31||PCS": 0.066667,
              "VELCRO 25 MM HOOK||MTR": 0.4,
              "VELCRO 25 MM LOOP||MTR": 0.4,
              "BUCKLE PF-3||PCS": 4
            }
          }
        },
        "8X10B": {
          "stitching_combo": "8X10B",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.094963,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.08,
              "REXION 1.5MM FOR INTOE||MTR": 0.026296,
              "REXION 0.8MM FOR EYELET PATTI||MTR": 0.009778,
              "STIFFNER 1.4 MM||SHEET": 0.0182,
              "SKIN FIT 5 MM||MTR": 0.095267,
              "FOAM 10 MM||SHEET": 0.021733,
              "FOAM 20 MM||SHEET": 0.013533,
              "ASTAR 3 MM light||MTR": 0.017267,
              "ASTAR 3 MM Heavy||MTR": 0.033333,
              "INSOLE 4 MM||MTR": 0.036345,
              "R.||MTR": 0.037037
            },
            "STITCHING": {
              "Nylon Thread 3 Ply||CONE": 0.035333,
              "Polister Binding 12mm||MTR": 0.4,
              "Lebel Gola||MTR": 2,
              "PP Bag 18.5x31||PCS": 0.066667,
              "VELCRO 25 MM HOOK||MTR": 0.4,
              "VELCRO 25 MM LOOP||MTR": 0.4,
              "BUCKLE PF-3||PCS": 4
            }
          }
        }
      },
      "molding_machine": null
    },
    "REX GOLA (L)": {
      "sole_type": "PVC",
      "sole_assumed": false,
      "combo_order": [
        "8X10",
        "11X13",
        "1X3",
        "4X5",
        "6X7B",
        "8X10B"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "8X10": {
          "stitching_combo": "8X10",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.043259,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.058296,
              "REXION 1.5MM FOR INTOE||MTR": 0.013926,
              "STIFFNER 1.4 MM||MTR": 0.0104,
              "SKIN FIT 5 MM||MTR": 0.0526,
              "FOAM 10 MM||SHEET": 0.011333,
              "FOAM 20 MM||SHEET": 0.0102,
              "ASTAR 3 MM Heavy||MTR": 0.017867,
              "INSOLE 4 MM||MTR": 0.019172,
              "R.||MTR": 0.019259
            },
            "STITCHING": {
              "Nylonthread 3 ply||CONE": 0.021333,
              "Polister Binding 12mm||MTR": 0.32,
              "Lebel Gola||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.05
            }
          }
        },
        "11X13": {
          "stitching_combo": "11X13",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.049704,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.064222,
              "REXION 1.5MM FOR INTOE||MTR": 0.015185,
              "STIFFNER 1.4 MM||MTR": 0.0122,
              "SKIN FIT 5 MM||MTR": 0.055533,
              "FOAM 10 MM||SHEET": 0.014267,
              "FOAM 20 MM||SHEET": 0.0102,
              "ASTAR 3 MM Heavy||MTR": 0.0222,
              "INSOLE 4 MM||MTR": 0.022207,
              "R.||MTR": 0.023778
            },
            "STITCHING": {
              "Nylonthread 3 ply||CONE": 0.024667,
              "Polister Binding 12mm||MTR": 0.36,
              "Lebel Gola||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.05
            }
          }
        },
        "1X3": {
          "stitching_combo": "1X5",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.057407,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.077926,
              "REXION 1.5MM FOR INTOE||MTR": 0.016667,
              "STIFFNER 1.4 MM||MTR": 0.013867,
              "SKIN FIT 5 MM||MTR": 0.076933,
              "FOAM 10 MM||SHEET": 0.018533,
              "FOAM 20 MM||SHEET": 0.013133,
              "ASTAR 3 MM light||MTR": 0.011133,
              "ASTAR 3 MM Heavy||MTR": 0.026333,
              "INSOLE 4 MM||MTR": 0.028552,
              "R.||MTR": 0.030296
            },
            "STITCHING": {
              "Nylonthread 3 ply||CONE": 0.027333,
              "Polister Binding 12mm||MTR": 0.38,
              "Lebel Gola||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.05
            }
          }
        },
        "4X5": {
          "stitching_combo": "1X5",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.064815,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.085556,
              "REXION 1.5MM FOR INTOE||MTR": 0.02,
              "STIFFNER 1.4 MM||MTR": 0.015133,
              "SKIN FIT 5 MM||MTR": 0.083333,
              "FOAM 10 MM||SHEET": 0.018533,
              "FOAM 20 MM||SHEET": 0.013133,
              "ASTAR 3 MM light||MTR": 0.013533,
              "ASTAR 3 MM Heavy||MTR": 0.026333,
              "INSOLE 4 MM||MTR": 0.030276,
              "R.||MTR": 0.030296
            },
            "STITCHING": {
              "Nylonthread 3 ply||CONE": 0.027333,
              "Polister Binding 12mm||MTR": 0.38,
              "Lebel Gola||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.05
            }
          }
        },
        "6X7B": {
          "stitching_combo": "6X11B",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.066296,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.083185,
              "REXION 1.5MM FOR INTOE||MTR": 0.026296,
              "STIFFNER 1.4 MM||MTR": 0.017067,
              "SKIN FIT 5 MM||MTR": 0.083333,
              "FOAM 10 MM||SHEET": 0.021733,
              "FOAM 20 MM||SHEET": 0.0156,
              "ASTAR 3 MM light||MTR": 0.015133,
              "ASTAR 3 MM Heavy||MTR": 0.033333,
              "INSOLE 4 MM||MTR": 0.036345,
              "R.||MTR": 0.04
            },
            "STITCHING": {
              "Nylonthread 3 ply||CONE": 0.031333,
              "Polister Binding 12mm||MTR": 0.4,
              "Lebel Gola||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.05
            }
          }
        },
        "8X10B": {
          "stitching_combo": "6X11B",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY)||MTR": 0.074074,
              "REXION 1.5MM FRENZY (LIGHT)||MTR": 0.092074,
              "REXION 1.5MM FOR INTOE||MTR": 0.026296,
              "STIFFNER 1.4 MM||MTR": 0.0182,
              "SKIN FIT 5 MM||MTR": 0.095267,
              "FOAM 10 MM||SHEET": 0.021733,
              "FOAM 20 MM||SHEET": 0.013533,
              "ASTAR 3 MM light||MTR": 0.017267,
              "ASTAR 3 MM Heavy||MTR": 0.033333,
              "INSOLE 4 MM||MTR": 0.041655,
              "R.||MTR": 0.037037
            },
            "STITCHING": {
              "Nylonthread 3 ply||CONE": 0.031333,
              "Polister Binding 12mm||MTR": 0.4,
              "Lebel Gola||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.05
            }
          }
        }
      },
      "molding_machine": null
    },
    "SILKY BELLY BLACK": {
      "sole_type": "PVC",
      "sole_assumed": false,
      "combo_order": [
        "6X8",
        "9X11",
        "12X1",
        "2X5",
        "6X7B",
        "8X9B"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "6X8": {
          "stitching_combo": "6X8",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.04437,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.011556,
              "REXION 0.85 MM BLACK||MTR": 0.003556,
              "INSOLE 2.5 MM BLACK||MTR": 0.0142
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.008,
              "Nylon Binding Black 14mm||MTR": 0.6,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        },
        "9X11": {
          "stitching_combo": "9X1",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.051185,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.014593,
              "REXION 0.85 MM BLACK||MTR": 0.004593,
              "INSOLE 2.5 MM BLACK||MTR": 0.018667
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.008667,
              "Nylon Binding Black 14mm||MTR": 0.75,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        },
        "12X1": {
          "stitching_combo": "9X1",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.056,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.01763,
              "REXION 0.85 MM BLACK||MTR": 0.004667,
              "INSOLE 2.5 MM BLACK||MTR": 0.02
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.008667,
              "Nylon Binding Black 14mm||MTR": 0.75,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        },
        "2X5": {
          "stitching_combo": "2X5",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.076444,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.022,
              "REXION 0.85 MM BLACK||MTR": 0.005333,
              "INSOLE 2.5 MM BLACK||MTR": 0.026867
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.009333,
              "Nylon Binding Black 14mm||MTR": 0.95,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        },
        "6X7B": {
          "stitching_combo": "6X7B",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.074963,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.021556,
              "REXION 0.85 MM BLACK||MTR": 0.004889,
              "INSOLE 2.5 MM BLACK||MTR": 0.031667
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.009667,
              "Nylon Binding Black 14mm||MTR": 1.1,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        },
        "8X9B": {
          "stitching_combo": "6X7B",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.087407,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.022889,
              "REXION 0.85 MM BLACK||MTR": 0.005333,
              "INSOLE 2.5 MM BLACK||MTR": 0.031667
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.009667,
              "Nylon Binding Black 14mm||MTR": 1.1,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        }
      },
      "molding_machine": null
    },
    "SILKY BELLY WHITE": {
      "sole_type": "PVC",
      "sole_assumed": false,
      "combo_order": [
        "6X8",
        "9X11",
        "12X1",
        "2X5",
        "6X7B",
        "8X9B"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "6X8": {
          "stitching_combo": "6X8",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.04437,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.011556,
              "REXION 0.85 MM WHITE||MTR": 0.003556,
              "INSOLE 2.5 MM WHITE||MTR": 0.0142
            },
            "STITCHING": {
              "NYLON THREAD WHITE 3 PLY||CONE": 0.008,
              "REXION BENDING 14 MM WHITE||MTR": 0.6,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        },
        "9X11": {
          "stitching_combo": "9X1",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.051185,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.014593,
              "REXION 0.85 MM WHITE||MTR": 0.004593,
              "INSOLE 2.5 MM WHITE||MTR": 0.018667
            },
            "STITCHING": {
              "NYLON THREAD WHITE 3 PLY||CONE": 0.008667,
              "REXION BENDING 14 MM WHITE||MTR": 0.75,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        },
        "12X1": {
          "stitching_combo": "9X1",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.056,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.01763,
              "REXION 0.85 MM WHITE||MTR": 0.004667,
              "INSOLE 2.5 MM WHITE||MTR": 0.02
            },
            "STITCHING": {
              "NYLON THREAD WHITE 3 PLY||CONE": 0.008667,
              "REXION BENDING 14 MM WHITE||MTR": 0.75,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        },
        "2X5": {
          "stitching_combo": "2X5",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.076444,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.022,
              "REXION 0.85 MM WHITE||MTR": 0.005333,
              "INSOLE 2.5 MM WHITE||MTR": 0.026867
            },
            "STITCHING": {
              "NYLON THREAD WHITE 3 PLY||CONE": 0.009333,
              "REXION BENDING 14 MM WHITE||MTR": 0.95,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        },
        "6X7B": {
          "stitching_combo": "6X7B",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.074963,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.021556,
              "REXION 0.85 MM WHITE||MTR": 0.004889,
              "INSOLE 2.5 MM WHITE||MTR": 0.031667
            },
            "STITCHING": {
              "NYLON THREAD WHITE 3 PLY||CONE": 0.009667,
              "REXION BENDING 14 MM WHITE||MTR": 1.1,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        },
        "8X9B": {
          "stitching_combo": "6X7B",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.087407,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.022889,
              "REXION 0.85 MM WHITE||MTR": 0.005333,
              "INSOLE 2.5 MM WHITE||MTR": 0.031667
            },
            "STITCHING": {
              "NYLON THREAD WHITE 3 PLY||CONE": 0.009667,
              "REXION BENDING 14 MM WHITE||MTR": 1.1,
              "PP Bag 18.5x31||PCS": 0.033333
            }
          }
        }
      },
      "molding_machine": null
    },
    "SMART BOY (L) BLACK": {
      "sole_type": "PVC",
      "sole_assumed": true,
      "combo_order": [
        "6X8",
        "9X11",
        "12X1",
        "2X5",
        "6X10B"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "6X8": {
          "stitching_combo": "6X8",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.065037,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.006667,
              "ASTER BLACK HEAVY||MTR": 0.0048,
              "INSOLE 4 MM BLACK||MTR": 0.016897
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.011333,
              "Cotton Thread Black||TUBE": 0.002222,
              "Nylon Binding Black 14mm||MTR": 1.1,
              "Lebel school shoe Black Small||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.033333,
              "DOCTOR TAPE||MTR": 0.05
            }
          }
        },
        "9X11": {
          "stitching_combo": "9X13",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.076296,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.017037,
              "ASTER BLACK HEAVY||MTR": 0.005133,
              "INSOLE 4 MM BLACK||MTR": 0.020207
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.012667,
              "Cotton Thread Black||TUBE": 0.002222,
              "Nylon Binding Black 14mm||MTR": 1.17,
              "Lebel school shoe Black Small||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.033333,
              "DOCTOR TAPE||MTR": 0.05
            }
          }
        },
        "12X1": {
          "stitching_combo": "9X13",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.094741,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.019407,
              "ASTER BLACK HEAVY||MTR": 0.005933,
              "INSOLE 4 MM BLACK||MTR": 0.022207
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.012667,
              "Cotton Thread Black||TUBE": 0.002222,
              "Nylon Binding Black 14mm||MTR": 1.17,
              "Lebel school shoe Black Small||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.033333,
              "DOCTOR TAPE||MTR": 0.05
            }
          }
        },
        "2X5": {
          "stitching_combo": "1X5",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.111704,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.022889,
              "ASTER BLACK HEAVY||MTR": 0.0068,
              "INSOLE 4 MM BLACK||MTR": 0.031241
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.014,
              "Cotton Thread Black||TUBE": 0.002222,
              "Nylon Binding Black 14mm||MTR": 1.32,
              "PP Bag 18.5x31||PCS": 0.033333,
              "tung label school shoe black big||PCS": 2,
              "DOCTOR TAPE||MTR": 0.05
            }
          }
        },
        "6X10B": {
          "stitching_combo": "6X10B",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": 0.130889,
              "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": 0.03,
              "ASTER BLACK HEAVY||MTR": 0.008133,
              "INSOLE 4 MM BLACK||MTR": 0.038483,
              "ASTAR 3 MM black light||MTR": 0.102867
            },
            "STITCHING": {
              "Nylon Thread Black 3 Ply||CONE": 0.018,
              "Cotton Thread Black||TUBE": 0.002778,
              "Nylon Binding Black 14mm||MTR": 1.45,
              "PP Bag 18.5x31||PCS": 0.033333,
              "tung label school shoe black big||PCS": 2,
              "DOCTOR TAPE||MTR": 0.05
            }
          }
        }
      },
      "molding_machine": null
    },
    "SMART BOY (L) WHITE": {
      "sole_type": "PVC",
      "sole_assumed": true,
      "combo_order": [
        "6X8",
        "9X11",
        "12X1",
        "2X5",
        "6X10B"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "6X8": {
          "stitching_combo": "6X8",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.065037,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.006667,
              "ASTER WHITE HEAVY||MTR": 0.0048,
              "INSOLE 4 MM WHITE||MTR": 0.016897
            },
            "STITCHING": {
              "Nylon Thread WHITE 3 Ply||CONE": 0.011333,
              "Cotton Thread WHITE||TUBE": 0.002222,
              "REXION Binding WHITE 14mm||MTR": 1.1,
              "Lebel school shoe WHITE Small||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.033333,
              "DOCTOR TAPE||MTR": 0.05
            }
          }
        },
        "9X11": {
          "stitching_combo": "9X13",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.076296,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.017037,
              "ASTER WHITE HEAVY||MTR": 0.005133,
              "INSOLE 4 MM WHITE||MTR": 0.020207
            },
            "STITCHING": {
              "Nylon Thread WHITE 3 Ply||CONE": 0.012667,
              "Cotton Thread WHITE||TUBE": 0.002222,
              "REXION Binding WHITE 14mm||MTR": 1.17,
              "Lebel school shoe WHITE Small||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.033333,
              "DOCTOR TAPE||MTR": 0.05
            }
          }
        },
        "12X1": {
          "stitching_combo": "9X13",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.094741,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.019407,
              "ASTER WHITE HEAVY||MTR": 0.005933,
              "INSOLE 4 MM WHITE||MTR": 0.022207
            },
            "STITCHING": {
              "Nylon Thread WHITE 3 Ply||CONE": 0.012667,
              "Cotton Thread WHITE||TUBE": 0.002222,
              "REXION Binding WHITE 14mm||MTR": 1.17,
              "Lebel school shoe WHITE Small||PCS": 2,
              "PP Bag 18.5x31||PCS": 0.033333,
              "DOCTOR TAPE||MTR": 0.05
            }
          }
        },
        "2X5": {
          "stitching_combo": "1X5",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.111704,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.022889,
              "ASTER WHITE HEAVY||MTR": 0.0068,
              "INSOLE 4 MM WHITE||MTR": 0.031241
            },
            "STITCHING": {
              "Nylon Thread WHITE 3 Ply||CONE": 0.014,
              "Cotton Thread WHITE||TUBE": 0.002222,
              "REXION Binding WHITE 14mm||MTR": 1.32,
              "PP Bag 18.5x31||PCS": 0.033333,
              "tung label school shoe WHITE big||PCS": 2,
              "DOCTOR TAPE||MTR": 0.05
            }
          }
        },
        "6X10B": {
          "stitching_combo": "6X10B",
          "rates": {
            "CUTTING": {
              "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": 0.130889,
              "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": 0.03,
              "ASTER WHITE HEAVY||MTR": 0.008133,
              "INSOLE 4 MM WHITE||MTR": 0.038483,
              "ASTAR 3 MM WHITE light||MTR": 0.102867
            },
            "STITCHING": {
              "Nylon Thread WHITE 3 Ply||CONE": 0.018,
              "Cotton Thread WHITE||TUBE": 0.002778,
              "REXION Binding WHITE 14mm||MTR": 1.45,
              "PP Bag 18.5x31||PCS": 0.033333,
              "tung label school shoe WHITE big||PCS": 2,
              "DOCTOR TAPE||MTR": 0.05
            }
          }
        }
      },
      "molding_machine": null
    },
    "JILL": {
      "sole_type": "EVA",
      "sole_assumed": false,
      "combo_order": [
        "7X10S",
        "11X1",
        "2X5",
        "6X8",
        "9X12"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "7X10S": {
          "stitching_combo": "7X10S",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.08377425,
              "ASTER 60\"||MTR": 0.01234568,
              "SKINFIT 60\"||MTR": 0.03125,
              "REXINE 54\"||MTR": 0.06812385,
              "SHEET 1.4MM||MTR": 0.00757576,
              "SHEET 0.8MM||MTR": 0.00925926,
              "SHEET 20MM||MTR": 0.00783085,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 33.33333333,
              "THREAD 3 PLY COLOURED||MTR": 600.0,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.25,
              "PF-3||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 0.03703704,
              "VELCRO 20 MM LOOP||MTR": 0.03703704,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "BACK TAPE 14 MM||MTR": 0.16666667
            }
          }
        },
        "11X1": {
          "stitching_combo": "11X1",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.09120879,
              "ASTER 60\"||MTR": 0.01428571,
              "SKINFIT 60\"||MTR": 0.03508772,
              "REXINE 54\"||MTR": 0.08136124,
              "SHEET 1.4MM||MTR": 0.01005025,
              "SHEET 0.8MM||MTR": 0.01149425,
              "SHEET 20MM||MTR": 0.00952381,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 30.0,
              "THREAD 3 PLY COLOURED||MTR": 500.0,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.25,
              "VELCRO 20 MM HOOK||MTR": 0.03448276,
              "VELCRO 20 MM LOOP||MTR": 0.03448276,
              "BACK TAPE 14 MM||MTR": 0.16666667
            }
          }
        },
        "2X5": {
          "stitching_combo": "2X5",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.10183978,
              "ASTER 60\"||MTR": 0.01709402,
              "SKINFIT 60\"||MTR": 0.04545455,
              "REXINE 54\"||MTR": 0.0897707,
              "SHEET 1.4MM||MTR": 0.01169591,
              "SHEET 0.8MM||MTR": 0.0137931,
              "SHEET 20MM||MTR": 0.01169591,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 26.78571429,
              "THREAD 3 PLY COLOURED||MTR": 500.0,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.25,
              "PF-3||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 0.03125,
              "VELCRO 20 MM LOOP||MTR": 0.03125,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "BACK TAPE 14 MM||MTR": 0.14285714
            }
          }
        },
        "6X8": {
          "stitching_combo": "6X8",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.11904762,
              "ASTER 60\"||MTR": 0.01904762,
              "SKINFIT 60\"||MTR": 0.05,
              "REXINE 54\"||MTR": 0.10087264,
              "SHEET 1.4MM||MTR": 0.01133787,
              "SHEET 0.8MM||MTR": 0.01428571,
              "SHEET 20MM||MTR": 0.01481481,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 23.07692308,
              "THREAD 3 PLY COLOURED||MTR": 375.0,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-3||PCS": 0.25,
              "VELCRO 25 MM HOOK||MTR": 0.02631579,
              "VELCRO 25 MM LOOP||MTR": 0.02631579,
              "BACK TAPE 14 MM||MTR": 0.14285714
            }
          }
        },
        "9X12": {
          "stitching_combo": "9X12",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.13172967,
              "ASTER 60\"||MTR": 0.02061856,
              "SKINFIT 60\"||MTR": 0.05555556,
              "REXINE 54\"||MTR": 0.11060878,
              "SHEET 1.4MM||MTR": 0.01242236,
              "SHEET 0.8MM||MTR": 0.01574803,
              "SHEET 20MM||MTR": 0.01526718,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 33.33333333,
              "THREAD 3 PLY COLOURED||MTR": 600.0,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.25,
              "PF-3||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 0.03703704,
              "VELCRO 20 MM LOOP||MTR": 0.03703704,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "BACK TAPE 14 MM||MTR": 0.16666667
            }
          }
        }
      }
    },
    "ARMOUR": {
      "sole_type": "EVA",
      "sole_assumed": false,
      "combo_order": [
        "7X10S",
        "11X1",
        "2X5",
        "6X9",
        "9X12"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "7X10S": {
          "stitching_combo": "7X10S",
          "rates": {
            "CUTTING": {
              "REXINE 54\"||MTR": 0.08634863,
              "MESH 58\"||MTR": 0.04166667,
              "SKINFIT 60\"||MTR": 0.08154122,
              "SHEET 20MM||SHEET": 0.00909091,
              "SHEET 10MM||SHEET": 0.0125,
              "SHEET 1.4MM||SHEET": 0.03016022,
              "SHEET 0.8MM||SHEET": 0.00740741,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 26.78571429,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.25,
              "PF-3||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 0.03571429,
              "VELCRO 20 MM LOOP||MTR": 0.03571429,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "POLYESTER BINDING 12 MM||MTR": 0.03571429,
              "BACK TAPE 14 MM||MTR": 0.125
            }
          }
        },
        "11X1": {
          "stitching_combo": "11X1",
          "rates": {
            "CUTTING": {
              "REXINE 54\"||MTR": 0.1033278,
              "MESH 58\"||MTR": 0.05714286,
              "SKINFIT 60\"||MTR": 0.09023285,
              "SHEET 20MM||SHEET": 0.01,
              "SHEET 10MM||SHEET": 0.0125,
              "SHEET 1.4MM||SHEET": 0.03740171,
              "SHEET 0.8MM||SHEET": 0.0082713,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 24.59016393,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.25,
              "PF-3||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 0.03333333,
              "VELCRO 20 MM LOOP||MTR": 0.03333333,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "POLYESTER BINDING 12 MM||MTR": 0.03333333,
              "BACK TAPE 14 MM||MTR": 0.125
            }
          }
        },
        "2X5": {
          "stitching_combo": "2X5",
          "rates": {
            "CUTTING": {
              "REXINE 54\"||MTR": 0.12919084,
              "MESH 58\"||MTR": 0.06410256,
              "SKINFIT 60\"||MTR": 0.12535496,
              "SHEET 20MM||SHEET": 0.01333333,
              "SHEET 10MM||SHEET": 0.01428571,
              "SHEET 1.4MM||SHEET": 0.04386838,
              "SHEET 0.8MM||SHEET": 0.01298701,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 23.07692308,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.25,
              "PF-3||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 0.02702703,
              "VELCRO 20 MM LOOP||MTR": 0.02702703,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "POLYESTER BINDING 12 MM||MTR": 0.03125,
              "BACK TAPE 14 MM||MTR": 0.1
            }
          }
        },
        "6X9": {
          "stitching_combo": "6X9",
          "rates": {
            "CUTTING": {
              "REXINE 54\"||MTR": 0.14883753,
              "MESH 58\"||MTR": 0.08333333,
              "SKINFIT 60\"||MTR": 0.14126693,
              "SHEET 20MM||SHEET": 0.01428571,
              "SHEET 10MM||SHEET": 0.01470588,
              "SHEET 1.4MM||SHEET": 0.04870687,
              "SHEET 0.8MM||SHEET": 0.01569859,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 20.83333333,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.0,
              "PF-3||PCS": 0.25,
              "VELCRO 20 MM HOOK||MTR": 0.0,
              "VELCRO 20 MM LOOP||MTR": 0.0,
              "VELCRO 25 MM HOOK||MTR": 0.025,
              "VELCRO 25 MM LOOP||MTR": 0.025,
              "POLYESTER BINDING 12 MM||MTR": 0.02941176,
              "BACK TAPE 14 MM||MTR": 0.08333333
            }
          }
        },
        "9X12": {
          "stitching_combo": "9X12",
          "rates": {
            "CUTTING": {
              "REXINE 54\"||MTR": 0.15673438,
              "MESH 58\"||MTR": 0.5,
              "SKINFIT 60\"||MTR": 0.14122505,
              "SHEET 20MM||SHEET": 0.01408451,
              "SHEET 10MM||SHEET": 0.01449275,
              "SHEET 1.4MM||SHEET": 0.05807892,
              "SHEET 0.8MM||SHEET": 0.01470588,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 20.83333333,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.0,
              "PF-3||PCS": 0.25,
              "VELCRO 20 MM HOOK||MTR": 0.0,
              "VELCRO 20 MM LOOP||MTR": 0.0,
              "VELCRO 25 MM HOOK||MTR": 0.025,
              "VELCRO 25 MM LOOP||MTR": 0.025,
              "POLYESTER BINDING 12 MM||MTR": 0.02941176,
              "BACK TAPE 14 MM||MTR": 0.08333333
            }
          }
        }
      }
    },
    "PERCY": {
      "sole_type": "EVA",
      "sole_assumed": false,
      "combo_order": [
        "7X10S",
        "11X1",
        "2X5",
        "6X8",
        "9X12"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "7X10S": {
          "stitching_combo": "7X10S",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.07686181,
              "SKINFIT 60\"||MTR": 0.04805997,
              "REXINE 54\"||MTR": 0.07379381,
              "SHEET 1.4MM||SHEET": 0.01010101,
              "SHEET 0.8MM||SHEET": 0.00892857,
              "SHEET 20MM||SHEET": 0.00784314,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 50.0,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.25,
              "PF-3||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 3.57142857,
              "VELCRO 20 MM LOOP||MTR": 3.57142857,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "PP BAG||PCS": 0.04,
              "BACK TAPE 14 MM||MTR": 10.0,
              "POLYESTER BINDING 12 MM||MTR": 16.66666667
            }
          }
        },
        "11X1": {
          "stitching_combo": "11X1",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.08325123,
              "SKINFIT 60\"||MTR": 0.05132275,
              "REXINE 54\"||MTR": 0.08209859,
              "SHEET 1.4MM||SHEET": 0.01036269,
              "SHEET 0.8MM||SHEET": 0.00925926,
              "SHEET 20MM||SHEET": 0.00952381,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 42.85714286,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.25,
              "PF-3||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 3.33333333,
              "VELCRO 20 MM LOOP||MTR": 3.33333333,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "PP BAG||PCS": 0.0,
              "BACK TAPE 14 MM||MTR": 8.33333333,
              "POLYESTER BINDING 12 MM||MTR": 16.66666667
            }
          }
        },
        "2X5": {
          "stitching_combo": "2X5",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.11256912,
              "SKINFIT 60\"||MTR": 0.05703578,
              "REXINE 54\"||MTR": 0.09812519,
              "SHEET 1.4MM||SHEET": 0.01298701,
              "SHEET 0.8MM||SHEET": 0.01270648,
              "SHEET 20MM||SHEET": 0.01052632,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 37.5,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.25,
              "PF-3||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 2.7027027,
              "VELCRO 20 MM LOOP||MTR": 2.7027027,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "PP BAG||PCS": 0.0,
              "BACK TAPE 14 MM||MTR": 7.69230769,
              "POLYESTER BINDING 12 MM||MTR": 14.28571429
            }
          }
        },
        "6X8": {
          "stitching_combo": "6X8",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.11994949,
              "SKINFIT 60\"||MTR": 0.07022144,
              "REXINE 54\"||MTR": 0.11163456,
              "SHEET 1.4MM||SHEET": 0.01315789,
              "SHEET 0.8MM||SHEET": 0.01408451,
              "SHEET 20MM||SHEET": 0.01492537,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 33.33333333,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.0,
              "PF-3||PCS": 0.25,
              "VELCRO 20 MM HOOK||MTR": 0.0,
              "VELCRO 20 MM LOOP||MTR": 0.0,
              "VELCRO 25 MM HOOK||MTR": 2.5,
              "VELCRO 25 MM LOOP||MTR": 2.5,
              "PP BAG||PCS": 0.0,
              "BACK TAPE 14 MM||MTR": 6.66666667,
              "POLYESTER BINDING 12 MM||MTR": 14.28571429
            }
          }
        },
        "9X12": {
          "stitching_combo": "9X12",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.13412816,
              "SKINFIT 60\"||MTR": 0.07454585,
              "REXINE 54\"||MTR": 0.0956253,
              "SHEET 1.4MM||SHEET": 0.01333333,
              "SHEET 0.8MM||SHEET": 0.01680672,
              "SHEET 20MM||SHEET": 0.01666667,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||SPOOL": 33.33333333,
              "SIZE LABEL||PCS": 0.5,
              "TOUNG LABEL SNEAKER||PCS": 0.5,
              "PF-48||PCS": 0.0,
              "PF-3||PCS": 0.25,
              "VELCRO 20 MM HOOK||MTR": 0.0,
              "VELCRO 20 MM LOOP||MTR": 0.0,
              "VELCRO 25 MM HOOK||MTR": 2.5,
              "VELCRO 25 MM LOOP||MTR": 2.5,
              "PP BAG||PCS": 0.0,
              "BACK TAPE 14 MM||MTR": 6.66666667,
              "POLYESTER BINDING 12 MM||MTR": 14.28571429
            }
          }
        }
      }
    },
    "SPADE": {
      "sole_type": "EVA",
      "sole_assumed": false,
      "combo_order": [
        "7X10S",
        "11X1",
        "2X5",
        "6X7",
        "8X12"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "7X10S": {
          "stitching_combo": "7X10S",
          "rates": {
            "CUTTING": {
              "REXINE 54\"||MTR": 0.12539661,
              "HEAVY REXINE 54\"||MTR": 0.06645437,
              "HEAVY REXINE 54\"||SHEET": 0.00540541,
              "SHEET 0.8MM||SHEET": 0.008,
              "SHEET 1.4MM||SHEET": 0.01010101,
              "SHEET 20MM||MTR": 0.00787402,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 37.5,
              "THREAD 3 PLY (COLOURED||MTR": 250.0,
              "SIZE LABEL||MTR": 0.5,
              "TOUNGE LABEL||MTR": 0.5,
              "D-RING 20MM||CM": 0.25,
              "VELCRO 20 MM HOOK||MTR": 0.03571429,
              "VELCRO 20 MM LOOP||MTR": 0.03571429
            }
          }
        },
        "11X1": {
          "stitching_combo": "11X1",
          "rates": {
            "CUTTING": {
              "REXINE 54\"||MTR": 0.13767669,
              "HEAVY REXINE 54\"||MTR": 0.04346087,
              "HEAVY REXINE 54\"||SHEET": 0.0060241,
              "SHEET 0.8MM||SHEET": 0.00956938,
              "SHEET 1.4MM||SHEET": 0.01034126,
              "SHEET 20MM||MTR": 0.00952381,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 33.33333333,
              "THREAD 3 PLY (COLOURED||MTR": 214.28571429,
              "SIZE LABEL||MTR": 0.5,
              "TOUNGE LABEL||MTR": 0.5,
              "D-RING 20MM||CM": 0.25,
              "VELCRO 20 MM HOOK||MTR": 0.03333333,
              "VELCRO 20 MM LOOP||MTR": 0.03333333
            }
          }
        },
        "2X5": {
          "stitching_combo": "2X5",
          "rates": {
            "CUTTING": {
              "REXINE 54\"||MTR": 0.170998,
              "HEAVY REXINE 54\"||MTR": 0.08649391,
              "HEAVY REXINE 54\"||SHEET": 0.00666667,
              "SHEET 0.8MM||SHEET": 0.01388889,
              "SHEET 1.4MM||SHEET": 0.01298701,
              "SHEET 20MM||MTR": 0.01104972,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 30.0,
              "THREAD 3 PLY (COLOURED||MTR": 187.5,
              "SIZE LABEL||MTR": 0.5,
              "TOUNGE LABEL||MTR": 0.5,
              "D-RING 20MM||CM": 0.25,
              "VELCRO 20 MM HOOK||MTR": 0.02702703,
              "VELCRO 20 MM LOOP||MTR": 0.02702703
            }
          }
        },
        "6X7": {
          "stitching_combo": "6X7",
          "rates": {
            "CUTTING": {
              "REXINE 54\"||MTR": 0.19698638,
              "HEAVY REXINE 54\"||MTR": 0.09899214,
              "HEAVY REXINE 54\"||SHEET": 0.00769231,
              "SHEET 0.8MM||SHEET": 0.01408451,
              "SHEET 1.4MM||SHEET": 0.01351351,
              "SHEET 20MM||MTR": 0.01481481,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 25.0,
              "THREAD 3 PLY (COLOURED||MTR": 166.66666667,
              "SIZE LABEL||MTR": 0.5,
              "TOUNGE LABEL||MTR": 0.5,
              "D-RING 25MM||CM": 0.25,
              "VELCRO 25 MM HOOK||PCS": 2.5,
              "VELCRO 25 MM LOOP||PCS": 2.5
            }
          }
        },
        "8X12": {
          "stitching_combo": "8X12",
          "rates": {
            "CUTTING": {
              "REXINE 54\"||MTR": 0.21475666,
              "HEAVY REXINE 54\"||MTR": 0.10977808,
              "HEAVY REXINE 54\"||SHEET": 0.00877193,
              "SHEET 0.8MM||SHEET": 0.01639344,
              "SHEET 1.4MM||SHEET": 0.01470588,
              "SHEET 20MM||MTR": 0.01680672,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 25.0,
              "THREAD 3 PLY (COLOURED||MTR": 166.66666667,
              "SIZE LABEL||MTR": 0.5,
              "TOUNGE LABEL||MTR": 0.5,
              "D-RING 25MM||CM": 0.25,
              "VELCRO 25 MM HOOK||PCS": 2.5,
              "VELCRO 25 MM LOOP||PCS": 2.5
            }
          }
        }
      }
    },
    "SPIKE": {
      "sole_type": "EVA",
      "sole_assumed": false,
      "combo_order": [
        "7X10S",
        "11X1",
        "2X5",
        "6X8",
        "9X12"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "7X10S": {
          "stitching_combo": "7X10S",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.08377425,
              "SKINFIT 60\"||MTR": 0.04359568,
              "REXINE 54\"||MTR": 0.04079502,
              "SHEET 1.4MM||SHEET": 0.00757576,
              "SHEET 20MM||SHEET": 0.00787402,
              "SHEET 0.8MM||SHEET": 0.00826446,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 41.66666667,
              "SIZE LABEL||PCS": 0.5,
              "PF-48 BLACK||PCS": 0.25,
              "PF-3 BLACK||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 0.03703704,
              "VELCRO 20 MM LOOP||MTR": 0.03703704,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "LYCRA BINDING||CM": 14.28571429,
              "BACK TAPE 14 MM||MTR": 0.05555556
            }
          }
        },
        "11X1": {
          "stitching_combo": "11X1",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.08571428,
              "SKINFIT 60\"||MTR": 0.05,
              "REXINE 54\"||MTR": 0.04590666,
              "SHEET 1.4MM||SHEET": 0.01010101,
              "SHEET 20MM||SHEET": 0.00952381,
              "SHEET 0.8MM||SHEET": 0.00833333,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 37.5,
              "SIZE LABEL||PCS": 0.5,
              "PF-48 BLACK||PCS": 0.25,
              "PF-3 BLACK||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 0.03448276,
              "VELCRO 20 MM LOOP||MTR": 0.03448276,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "LYCRA BINDING||CM": 14.28571429,
              "BACK TAPE 14 MM||MTR": 0.05263158
            }
          }
        },
        "2X5": {
          "stitching_combo": "2X5",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.10106939,
              "SKINFIT 60\"||MTR": 0.06051404,
              "REXINE 54\"||MTR": 0.05485593,
              "SHEET 1.4MM||SHEET": 0.01169591,
              "SHEET 20MM||SHEET": 0.01165501,
              "SHEET 0.8MM||SHEET": 0.0125,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 31.25,
              "SIZE LABEL||PCS": 0.5,
              "PF-48 BLACK||PCS": 0.25,
              "PF-3 BLACK||PCS": 0.0,
              "VELCRO 20 MM HOOK||MTR": 0.03125,
              "VELCRO 20 MM LOOP||MTR": 0.03125,
              "VELCRO 25 MM HOOK||MTR": 0.0,
              "VELCRO 25 MM LOOP||MTR": 0.0,
              "LYCRA BINDING||CM": 14.28571429,
              "BACK TAPE 14 MM||MTR": 0.05
            }
          }
        },
        "6X8": {
          "stitching_combo": "6X8",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.11893939,
              "SKINFIT 60\"||MTR": 0.06207729,
              "REXINE 54\"||MTR": 0.05999963,
              "SHEET 1.4MM||SHEET": 0.01136364,
              "SHEET 20MM||SHEET": 0.01492537,
              "SHEET 0.8MM||SHEET": 0.01162791,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 25.86206897,
              "SIZE LABEL||PCS": 0.5,
              "PF-48 BLACK||PCS": 0.0,
              "PF-3 BLACK||PCS": 0.25,
              "VELCRO 20 MM HOOK||MTR": 0.0,
              "VELCRO 20 MM LOOP||MTR": 0.0,
              "VELCRO 25 MM HOOK||MTR": 0.02631579,
              "VELCRO 25 MM LOOP||MTR": 0.02631579,
              "LYCRA BINDING||CM": 12.5,
              "BACK TAPE 14 MM||MTR": 0.04761905
            }
          }
        },
        "9X12": {
          "stitching_combo": "9X12",
          "rates": {
            "CUTTING": {
              "MESH 58\"||MTR": 0.13194444,
              "SKINFIT 60\"||MTR": 0.07638889,
              "REXINE 54\"||MTR": 0.06519085,
              "SHEET 1.4MM||SHEET": 0.01239157,
              "SHEET 20MM||SHEET": 0.01680672,
              "SHEET 0.8MM||SHEET": 0.01234568,
              "INSOLE||PAIR": 2.0
            },
            "MOLDING": {
              "SOLE 1231 EVA||PAIR": 2.0
            },
            "PACKING": {
              "TISSUE PAPER||PCS": 0.25,
              "SHOE SHINER||GRAM": 0.06666667,
              "EMYLE||GRAM": 0.07142857,
              "TAG PIN||PCS": 1.0,
              "TAG CARD||PCS": 1.0,
              "WRAPING PAPER||PCS": 1.0,
              "INNER||PCS": 1.0,
              "BARCODE STICKER||PCS": 1.0,
              "CTN TAPE (1 CTN)||MTR": 0.5,
              "STRAPING ROLL (1CTN)||MTR": 0.25
            },
            "STITCHING": {
              "THREAD 3 PLY||MTR": 25.86206897,
              "SIZE LABEL||PCS": 0.5,
              "PF-48 BLACK||PCS": 0.0,
              "PF-3 BLACK||PCS": 0.25,
              "VELCRO 20 MM HOOK||MTR": 0.0,
              "VELCRO 20 MM LOOP||MTR": 0.0,
              "VELCRO 25 MM HOOK||MTR": 0.02631579,
              "VELCRO 25 MM LOOP||MTR": 0.02631579,
              "LYCRA BINDING||CM": 12.5,
              "BACK TAPE 14 MM||MTR": 0.04761905
            }
          }
        }
      }
    },
    "REX GOLA PLUS": {
      "sole_type": "PVC",
      "sole_assumed": false,
      "combo_order": [
        "7X10",
        "11X1",
        "2X5",
        "6X12B"
      ],
      "routing": [
        "CUTTING",
        "PREPARATION",
        "STITCHING",
        "UPPER_QC",
        "MOLDING",
        "PACKING",
        "DISPATCH"
      ],
      "combos": {
        "7X10": {
          "stitching_combo": "7X10",
          "rates": {}
        },
        "11X1": {
          "stitching_combo": "11X1",
          "rates": {}
        },
        "2X5": {
          "stitching_combo": "2X5",
          "rates": {}
        },
        "6X12B": {
          "stitching_combo": "6X12B",
          "rates": {}
        }
      },
      "molding_machine": null
    }
  },
  "materials": {
    "ARMOR REXION||MTR": {
      "name": "ARMOR REXION",
      "uom": "MTR",
      "stock": 1229
    },
    "ASTAR 3 MM Heavy||MTR": {
      "name": "ASTAR 3 MM Heavy",
      "uom": "MTR",
      "stock": 134.5
    },
    "ASTAR 3 MM WHITE light||MTR": {
      "name": "ASTAR 3 MM WHITE light",
      "uom": "MTR",
      "stock": 98.8
    },
    "ASTAR 3 MM black light||MTR": {
      "name": "ASTAR 3 MM black light",
      "uom": "MTR",
      "stock": 161
    },
    "ASTAR 3 MM light||MTR": {
      "name": "ASTAR 3 MM light",
      "uom": "MTR",
      "stock": 81
    },
    "ASTER BLACK HEAVY||MTR": {
      "name": "ASTER BLACK HEAVY",
      "uom": "MTR",
      "stock": 15.6
    },
    "ASTER HEAVY FOR TOUNG||MTR": {
      "name": "ASTER HEAVY FOR TOUNG",
      "uom": "MTR",
      "stock": 152.5
    },
    "ASTER WHITE HEAVY||MTR": {
      "name": "ASTER WHITE HEAVY",
      "uom": "MTR",
      "stock": 52.4
    },
    "BACK TAPE 14 MM||MTR": {
      "name": "BACK TAPE 14 MM",
      "uom": "MTR",
      "stock": 627
    },
    "BUCKLE PF-3||PCS": {
      "name": "BUCKLE PF-3",
      "uom": "PCS",
      "stock": 383
    },
    "Buckle PF-48||PCS": {
      "name": "Buckle PF-48",
      "uom": "PCS",
      "stock": 26100
    },
    "COLOR FOAM 20MM||SHEET": {
      "name": "COLOR FOAM 20MM",
      "uom": "SHEET",
      "stock": 59.4
    },
    "Cotton Thread Black||TUBE": {
      "name": "Cotton Thread Black",
      "uom": "TUBE",
      "stock": 18.7
    },
    "Cotton Thread WHITE||TUBE": {
      "name": "Cotton Thread WHITE",
      "uom": "TUBE",
      "stock": 8.9
    },
    "DOCTOR TAPE||MTR": {
      "name": "DOCTOR TAPE",
      "uom": "MTR",
      "stock": 977.5
    },
    "DRILL CLOTH||MTR": {
      "name": "DRILL CLOTH",
      "uom": "MTR",
      "stock": 45.5
    },
    "FOAM 10 MM||SHEET": {
      "name": "FOAM 10 MM",
      "uom": "SHEET",
      "stock": 158.5
    },
    "FOAM 20 MM||SHEET": {
      "name": "FOAM 20 MM",
      "uom": "SHEET",
      "stock": 212.5
    },
    "INSOLE 2.5 MM BLACK||MTR": {
      "name": "INSOLE 2.5 MM BLACK",
      "uom": "MTR",
      "stock": 119.2
    },
    "INSOLE 2.5 MM WHITE||MTR": {
      "name": "INSOLE 2.5 MM WHITE",
      "uom": "MTR",
      "stock": 160.3
    },
    "INSOLE 4 MM BLACK||MTR": {
      "name": "INSOLE 4 MM BLACK",
      "uom": "MTR",
      "stock": 223.5
    },
    "INSOLE 4 MM WHITE||MTR": {
      "name": "INSOLE 4 MM WHITE",
      "uom": "MTR",
      "stock": 67.6
    },
    "INSOLE 4 MM||MTR": {
      "name": "INSOLE 4 MM",
      "uom": "MTR",
      "stock": 526.2
    },
    "Lebel Gola||MTR": {
      "name": "Lebel Gola",
      "uom": "MTR",
      "stock": 7650
    },
    "Lebel Gola||PCS": {
      "name": "Lebel Gola",
      "uom": "PCS",
      "stock": 16660
    },
    "Lebel school shoe Black Small||PCS": {
      "name": "Lebel school shoe Black Small",
      "uom": "PCS",
      "stock": 4480
    },
    "Lebel school shoe WHITE Small||PCS": {
      "name": "Lebel school shoe WHITE Small",
      "uom": "PCS",
      "stock": 8140
    },
    "NYLON THREAD WHITE 3 PLY||CONE": {
      "name": "NYLON THREAD WHITE 3 PLY",
      "uom": "CONE",
      "stock": 102
    },
    "Nylon Binding Black 14mm||MTR": {
      "name": "Nylon Binding Black 14mm",
      "uom": "MTR",
      "stock": 10829.2
    },
    "Nylon Thread 3 Ply||CONE": {
      "name": "Nylon Thread 3 Ply",
      "uom": "CONE",
      "stock": 181.9
    },
    "Nylon Thread Black 3 Ply||CONE": {
      "name": "Nylon Thread Black 3 Ply",
      "uom": "CONE",
      "stock": 231.2
    },
    "Nylon Thread WHITE 3 Ply||CONE": {
      "name": "Nylon Thread WHITE 3 Ply",
      "uom": "CONE",
      "stock": 38
    },
    "Nylonthread 3 ply||CONE": {
      "name": "Nylonthread 3 ply",
      "uom": "CONE",
      "stock": 148.6
    },
    "PF-3||PCS": {
      "name": "PF-3",
      "uom": "PCS",
      "stock": 3060
    },
    "PF-48||PCS": {
      "name": "PF-48",
      "uom": "PCS",
      "stock": 31280
    },
    "POLYESTER BINDING 12 MM||MTR": {
      "name": "POLYESTER BINDING 12 MM",
      "uom": "MTR",
      "stock": 1139.2
    },
    "PP Bag 18.5x31||PCS": {
      "name": "PP Bag 18.5x31",
      "uom": "PCS",
      "stock": 1545.5
    },
    "PU MESH (HARD FOAM+BACKER)||MTR": {
      "name": "PU MESH (HARD FOAM+BACKER)",
      "uom": "MTR",
      "stock": 1302.4
    },
    "Polister Binding 12mm||MTR": {
      "name": "Polister Binding 12mm",
      "uom": "MTR",
      "stock": 2517
    },
    "R.||MTR": {
      "name": "R.",
      "uom": "MTR",
      "stock": 315.2
    },
    "REXION 0.85 MM BLACK||MTR": {
      "name": "REXION 0.85 MM BLACK",
      "uom": "MTR",
      "stock": 53.5
    },
    "REXION 0.85 MM WHITE||MTR": {
      "name": "REXION 0.85 MM WHITE",
      "uom": "MTR",
      "stock": 16.8
    },
    "REXION 0.8MM FOR EYELET PATTI||MTR": {
      "name": "REXION 0.8MM FOR EYELET PATTI",
      "uom": "MTR",
      "stock": 53.9
    },
    "REXION 1.5MM FOR INTOE||MTR": {
      "name": "REXION 1.5MM FOR INTOE",
      "uom": "MTR",
      "stock": 132
    },
    "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR": {
      "name": "REXION 1.5MM FRENZY (HEAVY) BLACK",
      "uom": "MTR",
      "stock": 1781.5
    },
    "REXION 1.5MM FRENZY (HEAVY) WHITE||MTR": {
      "name": "REXION 1.5MM FRENZY (HEAVY) WHITE",
      "uom": "MTR",
      "stock": 308.3
    },
    "REXION 1.5MM FRENZY (HEAVY)||MTR": {
      "name": "REXION 1.5MM FRENZY (HEAVY)",
      "uom": "MTR",
      "stock": 614.1
    },
    "REXION 1.5MM FRENZY (LIGHT) BLACK||MTR": {
      "name": "REXION 1.5MM FRENZY (LIGHT) BLACK",
      "uom": "MTR",
      "stock": 473.8
    },
    "REXION 1.5MM FRENZY (LIGHT) WHITE||MTR": {
      "name": "REXION 1.5MM FRENZY (LIGHT) WHITE",
      "uom": "MTR",
      "stock": 141.2
    },
    "REXION 1.5MM FRENZY (LIGHT)||MTR": {
      "name": "REXION 1.5MM FRENZY (LIGHT)",
      "uom": "MTR",
      "stock": 782.6
    },
    "REXION BENDING 14 MM WHITE||MTR": {
      "name": "REXION BENDING 14 MM WHITE",
      "uom": "MTR",
      "stock": 6844
    },
    "REXION Binding WHITE 14mm||MTR": {
      "name": "REXION Binding WHITE 14mm",
      "uom": "MTR",
      "stock": 3403.2
    },
    "SIZE LABEL||PCS": {
      "name": "SIZE LABEL",
      "uom": "PCS",
      "stock": 22560
    },
    "SKIN FIT 5 MM||MTR": {
      "name": "SKIN FIT 5 MM",
      "uom": "MTR",
      "stock": 514.6
    },
    "SKINFIT GOLA ( FOAM + BACKER)||MTR": {
      "name": "SKINFIT GOLA ( FOAM + BACKER)",
      "uom": "MTR",
      "stock": 1048.1
    },
    "STIFFNER 1.4 MM||MTR": {
      "name": "STIFFNER 1.4 MM",
      "uom": "MTR",
      "stock": 25.1
    },
    "STIFFNER 1.4 MM||SHEET": {
      "name": "STIFFNER 1.4 MM",
      "uom": "SHEET",
      "stock": 62.4
    },
    "STIFNER 1.4MM YELLOW||SHEET": {
      "name": "STIFNER 1.4MM YELLOW",
      "uom": "SHEET",
      "stock": 148.4
    },
    "TEXION||SHEET": {
      "name": "TEXION",
      "uom": "SHEET",
      "stock": 209.4
    },
    "THREAD 3 PLY||SPOOL": {
      "name": "THREAD 3 PLY",
      "uom": "SPOOL",
      "stock": 484.8
    },
    "TOE PUFF 0.8MM||SHEET": {
      "name": "TOE PUFF 0.8MM",
      "uom": "SHEET",
      "stock": 147.8
    },
    "TOUNG LABEL SNEAKER||PCS": {
      "name": "TOUNG LABEL SNEAKER",
      "uom": "PCS",
      "stock": 11656
    },
    "VAMP ASTER DOUBLE BACKER||MTR": {
      "name": "VAMP ASTER DOUBLE BACKER",
      "uom": "MTR",
      "stock": 238.4
    },
    "VELCRO 20 MM HOOK||MTR": {
      "name": "VELCRO 20 MM HOOK",
      "uom": "MTR",
      "stock": 1240.1
    },
    "VELCRO 20 MM LOOP||MTR": {
      "name": "VELCRO 20 MM LOOP",
      "uom": "MTR",
      "stock": 2480.3
    },
    "VELCRO 25 MM HOOK||MTR": {
      "name": "VELCRO 25 MM HOOK",
      "uom": "MTR",
      "stock": 144
    },
    "VELCRO 25 MM LOOP||MTR": {
      "name": "VELCRO 25 MM LOOP",
      "uom": "MTR",
      "stock": 396
    },
    "Velcro 20mm Hook||MTR": {
      "name": "Velcro 20mm Hook",
      "uom": "MTR",
      "stock": 2864.5
    },
    "Velcro 20mm Loop||MTR": {
      "name": "Velcro 20mm Loop",
      "uom": "MTR",
      "stock": 1101.8
    },
    "tung label school shoe WHITE big||PCS": {
      "name": "tung label school shoe WHITE big",
      "uom": "PCS",
      "stock": 2080
    },
    "tung label school shoe black big||PCS": {
      "name": "tung label school shoe black big",
      "uom": "PCS",
      "stock": 4060
    },
    "MESH 58\"||MTR": {
      "name": "Mesh 58\"",
      "uom": "MTR",
      "stock": 0
    },
    "ASTER 60\"||MTR": {
      "name": "Aster 60\"",
      "uom": "MTR",
      "stock": 0
    },
    "SKINFIT 60\"||MTR": {
      "name": "Skinfit 60\"",
      "uom": "MTR",
      "stock": 0
    },
    "REXINE 54\"||MTR": {
      "name": "Rexine 54\"",
      "uom": "MTR",
      "stock": 0
    },
    "SHEET 1.4MM||MTR": {
      "name": "Sheet 1.4Mm",
      "uom": "MTR",
      "stock": 0
    },
    "SHEET 0.8MM||MTR": {
      "name": "Sheet 0.8Mm",
      "uom": "MTR",
      "stock": 0
    },
    "SHEET 20MM||MTR": {
      "name": "Sheet 20Mm",
      "uom": "MTR",
      "stock": 0
    },
    "THREAD 3 PLY||MTR": {
      "name": "Thread 3 Ply",
      "uom": "MTR",
      "stock": 0
    },
    "THREAD 3 PLY COLOURED||MTR": {
      "name": "Thread 3 Ply Coloured",
      "uom": "MTR",
      "stock": 0
    },
    "INSOLE||PAIR": {
      "name": "INSOLE",
      "uom": "PAIR",
      "stock": 0
    },
    "TISSUE PAPER||PCS": {
      "name": "Tissue Paper",
      "uom": "PCS",
      "stock": 0
    },
    "SHOE SHINER||GRAM": {
      "name": "Shoe Shiner",
      "uom": "GRAM",
      "stock": 0
    },
    "EMYLE||GRAM": {
      "name": "EMYLE",
      "uom": "GRAM",
      "stock": 0
    },
    "TAG PIN||PCS": {
      "name": "Tag Pin",
      "uom": "PCS",
      "stock": 0
    },
    "TAG CARD||PCS": {
      "name": "Tag Card",
      "uom": "PCS",
      "stock": 0
    },
    "WRAPING PAPER||PCS": {
      "name": "Wraping Paper",
      "uom": "PCS",
      "stock": 0
    },
    "INNER||PCS": {
      "name": "INNER",
      "uom": "PCS",
      "stock": 0
    },
    "BARCODE STICKER||PCS": {
      "name": "Barcode Sticker",
      "uom": "PCS",
      "stock": 0
    },
    "CTN TAPE (1 CTN)||MTR": {
      "name": "Ctn Tape (1 Ctn)",
      "uom": "MTR",
      "stock": 0
    },
    "STRAPING ROLL (1CTN)||MTR": {
      "name": "Straping Roll (1Ctn)",
      "uom": "MTR",
      "stock": 0
    },
    "SHEET 20MM||SHEET": {
      "name": "Sheet 20Mm",
      "uom": "SHEET",
      "stock": 0
    },
    "SHEET 10MM||SHEET": {
      "name": "Sheet 10Mm",
      "uom": "SHEET",
      "stock": 0
    },
    "SHEET 1.4MM||SHEET": {
      "name": "Sheet 1.4Mm",
      "uom": "SHEET",
      "stock": 0
    },
    "SHEET 0.8MM||SHEET": {
      "name": "Sheet 0.8Mm",
      "uom": "SHEET",
      "stock": 0
    },
    "PP BAG||PCS": {
      "name": "Pp Bag",
      "uom": "PCS",
      "stock": 0
    },
    "HEAVY REXINE 54\"||MTR": {
      "name": "Heavy Rexine 54\"",
      "uom": "MTR",
      "stock": 0
    },
    "HEAVY REXINE 54\"||SHEET": {
      "name": "Heavy Rexine 54\"",
      "uom": "SHEET",
      "stock": 0
    },
    "THREAD 3 PLY (COLOURED||MTR": {
      "name": "Thread 3 Ply (Coloured",
      "uom": "MTR",
      "stock": 0
    },
    "SIZE LABEL||MTR": {
      "name": "Size Label",
      "uom": "MTR",
      "stock": 0
    },
    "TOUNGE LABEL||MTR": {
      "name": "Tounge Label",
      "uom": "MTR",
      "stock": 0
    },
    "D-RING 20MM||CM": {
      "name": "D-Ring 20Mm",
      "uom": "CM",
      "stock": 0
    },
    "D-RING 25MM||CM": {
      "name": "D-Ring 25Mm",
      "uom": "CM",
      "stock": 0
    },
    "VELCRO 25 MM HOOK||PCS": {
      "name": "Velcro 25 Mm Hook",
      "uom": "PCS",
      "stock": 0
    },
    "VELCRO 25 MM LOOP||PCS": {
      "name": "Velcro 25 Mm Loop",
      "uom": "PCS",
      "stock": 0
    },
    "PF-48 BLACK||PCS": {
      "name": "Pf-48 Black",
      "uom": "PCS",
      "stock": 0
    },
    "PF-3 BLACK||PCS": {
      "name": "Pf-3 Black",
      "uom": "PCS",
      "stock": 0
    },
    "LYCRA BINDING||CM": {
      "name": "Lycra Binding",
      "uom": "CM",
      "stock": 0
    },
    "SOLE 1231 EVA||PAIR": {
      "name": "Sole 1231 EVA",
      "uom": "PAIR",
      "stock": 0
    }
  },
  "workcenters": {
    "CUTTING": {
      "name": "Cutting hall",
      "stage": "CUTTING",
      "capacity_per_day": 2500,
      "sole_type": null
    },
    "PREPARATION": {
      "name": "Preparation & printing",
      "stage": "PREPARATION",
      "capacity_per_day": 2000,
      "sole_type": null
    },
    "STITCHING": {
      "name": "Stitching lines",
      "stage": "STITCHING",
      "capacity_per_day": 2000,
      "sole_type": null
    },
    "UPPER_QC": {
      "name": "Upper QC & preparation",
      "stage": "UPPER_QC",
      "capacity_per_day": 2200,
      "sole_type": null
    },
    "MOLDING_PVC_ROTARY": {
      "name": "PVC rotary",
      "stage": "MOLDING",
      "capacity_per_day": 1200,
      "sole_type": "PVC",
      "exclusive": true
    },
    "MOLDING_PVC_VERTICAL": {
      "name": "PVC vertical",
      "stage": "MOLDING",
      "capacity_per_day": 1000,
      "sole_type": "PVC",
      "exclusive": true
    },
    "MOLDING_PU": {
      "name": "PU molding",
      "stage": "MOLDING",
      "capacity_per_day": 1000,
      "sole_type": "PU",
      "exclusive": true
    },
    "MOLDING_EVA": {
      "name": "EVA molding",
      "stage": "MOLDING",
      "capacity_per_day": 1500,
      "sole_type": "EVA",
      "exclusive": true
    },
    "ASSEMBLY_STUCK-ON": {
      "name": "Sole sticking",
      "stage": "ASSEMBLY",
      "capacity_per_day": 1800,
      "sole_type": "STUCK-ON"
    },
    "PACKING": {
      "name": "Packing",
      "stage": "PACKING",
      "capacity_per_day": 3000,
      "sole_type": null
    },
    "DISPATCH": {
      "name": "Dispatch",
      "stage": "DISPATCH",
      "capacity_per_day": 4000,
      "sole_type": null
    }
  },
  "packing": {
    "REX GOLA PLUS": {
      "7X10": 24,
      "11X1": 18,
      "2X5": 18,
      "6X12B": 18
    },
    "JILL": {
      "7X10S": 24,
      "11X1": 24,
      "2X5": 18,
      "6X8": 18,
      "9X12": 18
    },
    "ARMOUR": {
      "7X10S": 24,
      "11X1": 24,
      "2X5": 18,
      "6X9": 18,
      "9X12": 18
    },
    "PERCY": {
      "7X10S": 24,
      "11X1": 24,
      "2X5": 18,
      "6X8": 18,
      "9X12": 18
    },
    "SPADE": {
      "7X10S": 24,
      "11X1": 24,
      "2X5": 18,
      "6X7": 18,
      "8X12": 18
    },
    "SPIKE": {
      "7X10S": 24,
      "11X1": 24,
      "2X5": 18,
      "6X8": 18,
      "9X12": 18
    }
  },
  "mrp": {
    "REX GOLA PLUS": {
      "7X10": 679,
      "11X1": 749,
      "2X5": 799,
      "6X12B": 869
    }
  },
  "packing_singles": {
    "GOLA": {
      "kids": 24,
      "adult": 18
    },
    "SMART BOY": {
      "6-13": 48,
      "1-5": 36,
      "5.5": 24,
      "6-12": 18
    },
    "SILKY BLY": {
      "6-13": 48,
      "1-5": 36,
      "5.5-12": 24
    },
    "ARMOUR": {
      "kids": 24,
      "adult": 18
    }
  },
  "packing_singles_by_article": {
    "REX GOLA (V)": "GOLA",
    "REX GOLA (L)": "GOLA",
    "REX GOLA PLUS": "GOLA",
    "SMART BOY (L) BLACK": "SMART BOY",
    "SMART BOY (L) WHITE": "SMART BOY",
    "SILKY BELLY BLACK": "SILKY BLY",
    "SILKY BELLY WHITE": "SILKY BLY",
    "JILL": "ARMOUR",
    "ARMOUR": "ARMOUR",
    "PERCY": "ARMOUR",
    "SPADE": "ARMOUR",
    "SPIKE": "ARMOUR",
    "ARMOUR (VELCRO)": "ARMOUR",
    "ARMOUR (LACE)": "ARMOUR"
  },
  "lead_time_rules": {
    "stitching_inhouse_prep_days": 0,
    "stitching_outside_transport_days": 2,
    "printing_days": 1,
    "_note": "PLACEHOLDER day counts \u2014 confirm with the factory before trusting any date."
  }
};
