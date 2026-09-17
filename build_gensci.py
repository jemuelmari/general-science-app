#!/usr/bin/env python3
# ============================================================
# build_gensci.py — Auto-generate all week files for the
# General Science Online Modular Application.
#
# Usage:
#   1. Put this file at the ROOT of your empty repo folder
#      (next to where you'll place config.js, assets/, etc.)
#   2. Run:  python3 build_gensci.py
#   3. It creates all 30 weeks × (index.html, day.html, weekN.json)
#      under student/term1/, student/term2/, student/term3/
#
# To customize a week, edit the CONTENT dict below.
# ============================================================

import json
import os

# ------------------------------------------------------------
# WEEK CONTENT TABLE
# Each entry: (title, [competency codes+text], [day titles], [day descriptions])
# Days are always: 1=lesson, 2=activity1, 3=activity2, 4=formative
# ------------------------------------------------------------
CONTENT = {
    "term1": {
        "accent": "#0d47a1",
        "accent_light": "#00acc1",
        "weeks": {
            1: {
                "title": "Physics in Real Life — Foundations",
                "competencies": [("GENSCI-11-T1-W1-C1", "Identify how physics concepts improve quality of life in household, health & safety, work productivity, and leisure.")],
                "days": ["Introduction to Physics in Daily Life", "Match Game — Physics Applications", "Scenario Challenge — Life Areas", "Formative Check — Escape the Lab"],
                "day_descs": ["Overview of physics as a way of understanding the world.", "Match physics concepts to real-world applications.", "Choose the best physics reasoning for daily scenarios.", "Prove your mastery by unlocking all keys."],
                "badge": ("physicist", "Physicist", "⚛️")
            },
            2: {
                "title": "Linear vs Angular Motion",
                "competencies": [("GENSCI-11-T1-W2-C1", "Differentiate translational motion from rotational motion."), ("GENSCI-11-T1-W2-C2", "Relate linear quantities (displacement, velocity, acceleration) to angular quantities.")],
                "days": ["Translational vs Rotational Motion", "Match Game — Linear & Angular Quantities", "Scenario Challenge — Motion in Real Life", "Formative Check — Escape the Motion Lab"],
                "day_descs": ["Learn the two ways objects move and how linear ↔ angular relate.", "Match linear quantities to angular counterparts.", "Apply motion concepts to real-life scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("motion-master", "Motion Master", "🔄")
            },
            3: {
                "title": "Efficient Machines in Motion",
                "competencies": [("GENSCI-11-T1-W3-C1", "Design, construct, and test a simple or compound machine."), ("GENSCI-11-T1-W3-C2", "Apply torque, angular motion, and radius to improve machine efficiency.")],
                "days": ["Simple & Compound Machines", "Match Game — Machine Types", "Scenario Challenge — Torque & Efficiency", "Formative Check — Escape the Machine Shop"],
                "day_descs": ["Explore levers, pulleys, gears, and their combinations.", "Match each machine type to its function.", "Solve efficiency problems using torque concepts.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("machine-master", "Machine Master", "⚙️")
            },
            4: {
                "title": "Hydraulics & Energy Management",
                "competencies": [("GENSCI-11-T1-W4-C1", "Investigate how pressure is transmitted in fluids."), ("GENSCI-11-T1-W4-C2", "Explain how cross-sectional area affects output force. Analyze electricity consumption data.")],
                "days": ["Pascal's Principle & Fluid Pressure", "Match Game — Hydraulic Systems", "Scenario Challenge — Energy Consumption", "Formative Check — Escape the Energy Lab"],
                "day_descs": ["Understand how fluids transmit force through Pascal's Principle.", "Match hydraulic components to their roles.", "Analyze household energy consumption scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("hydraulics-pro", "Hydraulics Pro", "💧")
            },
            5: {
                "title": "Properties of Light",
                "competencies": [("GENSCI-11-T1-W5-C1", "Discuss properties of light waves in communications, navigation, medicine, and entertainment. Identify innovations like LEDs, lasers, and holograms.")],
                "days": ["Nature of Light Waves", "Match Game — Light Innovations", "Scenario Challenge — Light in Daily Life", "Formative Check — Escape the Optics Lab"],
                "day_descs": ["Explore reflection, refraction, and the EM spectrum.", "Match each light technology to its application.", "Solve light-based reasoning scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("optics-explorer", "Optics Explorer", "💡")
            },
            6: {
                "title": "Properties of Sound",
                "competencies": [("GENSCI-11-T1-W6-C1", "Discuss properties of sound waves in communications, navigation, medicine, and entertainment. Identify innovations like soundproofing and amplifiers.")],
                "days": ["Nature of Sound Waves", "Match Game — Sound Technologies", "Scenario Challenge — Sound Around Us", "Formative Check — Escape the Acoustics Lab"],
                "day_descs": ["Explore frequency, wavelength, amplitude, and the speed of sound.", "Match sound devices to their uses.", "Solve sound-based reasoning scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("sound-scientist", "Sound Scientist", "🔊")
            },
            7: {
                "title": "Chemistry Discoveries — Louis Pasteur",
                "competencies": [("GENSCI-11-T1-W7-C1", "Report how Louis Pasteur combined chemistry and biology to understand disease and prevent infection.")],
                "days": ["Louis Pasteur and Germ Theory", "Match Game — Pasteur's Contributions", "Scenario Challenge — Chemistry Meets Biology", "Formative Check — Escape the Pasteur Lab"],
                "day_descs": ["Learn how Pasteur linked chemistry to disease prevention.", "Match Pasteur's discoveries to their impact.", "Apply germ theory to modern health scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("pasteur-scholar", "Pasteur Scholar", "🧫")
            },
            8: {
                "title": "Chemistry of Household & Personal Care Products",
                "competencies": [("GENSCI-11-T1-W8-C1", "Construct a table using product labels (bleach, detergents, baking powder, shampoo, soap, toothpaste)."), ("GENSCI-11-T1-W8-C2", "Explain benefits/risks by referring to DTI, FDA, DENR.")],
                "days": ["Chemistry in Your Cabinet", "Match Game — Product Ingredients", "Scenario Challenge — Safe Product Use", "Formative Check — Escape the Household Chem Lab"],
                "day_descs": ["Explore the chemistry of everyday products.", "Match active ingredients to their functions.", "Apply DTI/FDA/DENR guidelines to scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("household-chemist", "Household Chemist", "🧴")
            },
            9: {
                "title": "Applications & Synthesis",
                "competencies": [("GENSCI-11-T1-W9-C1", "Synthesize physics and chemistry principles in real-world applications.")],
                "days": ["Putting Physics & Chemistry Together", "Match Game — Cross-Discipline Applications", "Scenario Challenge — Integrated Science", "Formative Check — Escape the Synthesis Lab"],
                "day_descs": ["See how physics and chemistry interact in daily tech.", "Match concepts to integrated applications.", "Solve scenarios needing both physics and chemistry.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("integrator", "Integrator", "🔬")
            },
            10: {
                "title": "Term Synthesis & Review",
                "competencies": [("GENSCI-11-T1-W10-C1", "Review all Term 1 competencies in preparation for the Term Exam.")],
                "days": ["Cumulative Review — Weeks 1–5", "Match Game — Term 1 Concepts", "Scenario Challenge — Full-Term Scenarios", "Formative Check — Escape the Term 1 Review"],
                "day_descs": ["Review physics concepts from Weeks 1–5.", "Match every Term 1 concept to its application.", "Solve integrated full-term scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("term1-finisher", "Term 1 Finisher", "🏁")
            }
        }
    },
    "term2": {
        "accent": "#00695c",
        "accent_light": "#00acc1",
        "weeks": {
            1: {
                "title": "Chemical Reactions in Everyday Lives",
                "competencies": [("GENSCI-11-T2-W1-C1", "Explain common reaction types: decomposition, acid on carbonates, acids on metals, combustion."), ("GENSCI-11-T2-W1-C2", "Identify reaction types in daily activities: baking, cleaning, burning.")],
                "days": ["Chemical Reactions Around Us", "Match Game — Reaction Types", "Scenario Challenge — Reactions at Home", "Formative Check — Escape the Chem Lab"],
                "day_descs": ["Learn the four common reaction types.", "Match each reaction to its real-life example.", "Identify reaction types in daily activities.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("chemist", "Chemist", "🧪")
            },
            2: {
                "title": "Reaction Types & Chemical Equations",
                "competencies": [("GENSCI-11-T2-W2-C1", "Use chemical equations for photosynthesis and respiration."), ("GENSCI-11-T2-W2-C2", "Describe metabolic reactions in body cells and their significance.")],
                "days": ["Balancing Chemical Equations", "Match Game — Equation Components", "Scenario Challenge — Reactions in Cells", "Formative Check — Escape the Equation Lab"],
                "day_descs": ["Learn to read and balance chemical equations.", "Match reactants, products, and coefficients.", "Apply equation reasoning to metabolic scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("reaction-master", "Reaction Master", "⚗️")
            },
            3: {
                "title": "Solutions in the Environment",
                "competencies": [("GENSCI-11-T2-W3-C1", "Explain characteristics of solutions in household products, industry, and environmental science."), ("GENSCI-11-T2-W3-C2", "Investigate salt's effect on plant growth.")],
                "days": ["Solutions & Their Properties", "Match Game — Solute & Solvent", "Scenario Challenge — Salt in the Environment", "Formative Check — Escape the Solutions Lab"],
                "day_descs": ["Explore the components and properties of solutions.", "Match solute, solvent, and concentration terms.", "Analyze salt's effect on plants and ecosystems.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("solution-scientist", "Solution Scientist", "💧")
            },
            4: {
                "title": "Safe Handling of Chemicals",
                "competencies": [("GENSCI-11-T2-W4-C1", "Apply best practices for handling, storage, and disposal of chemicals."), ("GENSCI-11-T2-W4-C2", "Create a table showing saltwater/wastewater effects on local ecosystems.")],
                "days": ["Safety First — Handling Chemicals", "Match Game — Safety Symbols", "Scenario Challenge — Wastewater in the Community", "Formative Check — Escape the Safety Lab"],
                "day_descs": ["Learn GHS hazard symbols and safe handling.", "Match each symbol to its hazard class.", "Analyze wastewater effects on local ecosystems.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("safety-officer", "Safety Officer", "🦺")
            },
            5: {
                "title": "Unifying Themes of Life Science",
                "competencies": [("GENSCI-11-T2-W5-C1", "Explain how life forms operate as systems of related parts. Create a diagram showing structure-function relationships.")],
                "days": ["Life as Interconnected Systems", "Match Game — Structure & Function", "Scenario Challenge — Systems Thinking", "Formative Check — Escape the Systems Lab"],
                "day_descs": ["Explore the unifying themes that connect all living things.", "Match biological structures to their functions.", "Apply systems thinking to life scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("life-scientist", "Life Scientist", "🌱")
            },
            6: {
                "title": "The Importance of Cells in Living Things",
                "competencies": [("GENSCI-11-T2-W6-C1", "Describe how cells obtain nutrients and convert them into energy.")],
                "days": ["Cells — The Unit of Life", "Match Game — Cell Organelles", "Scenario Challenge — Cell Energy", "Formative Check — Escape the Cell Lab"],
                "day_descs": ["Learn how cells obtain and use energy.", "Match organelles to their functions.", "Apply cell energy concepts to real scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("cell-explorer", "Cell Explorer", "🔬")
            },
            7: {
                "title": "Plant Organ Systems",
                "competencies": [("GENSCI-11-T2-W7-C1", "Explain plant organ interaction for material transport.")],
                "days": ["Plant Organs Working Together", "Match Game — Plant Tissues", "Scenario Challenge — Transport in Plants", "Formative Check — Escape the Botany Lab"],
                "day_descs": ["Learn how roots, stems, and leaves work together.", "Match plant tissues to their transport roles.", "Analyze plant transport in real conditions.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("botanist", "Botanist", "🌿")
            },
            8: {
                "title": "Animal Organ Systems & Immunity",
                "competencies": [("GENSCI-11-T2-W8-C1", "Explain nervous + endocrine coordination for temperature regulation."), ("GENSCI-11-T2-W8-C2", "Explain how vaccines work via immune + lymphatic systems."), ("GENSCI-11-T2-W8-C3", "Describe how damaged parts affect organisms (torn ACL, asthma attack).")],
                "days": ["Organ Systems Coordinating", "Match Game — Body Systems", "Scenario Challenge — Immunity & Injury", "Formative Check — Escape the Anatomy Lab"],
                "day_descs": ["Learn how organ systems coordinate for homeostasis.", "Match systems to their functions.", "Analyze injury and vaccination scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("systems-pro", "Systems Pro", "🫀")
            },
            9: {
                "title": "Philippine Ecosystems & Climate Change",
                "competencies": [("GENSCI-11-T2-W9-C1", "Describe climate change. Explain biological responses to climate change."), ("GENSCI-11-T2-W9-C2", "Explain climate change impacts on Philippine ecosystems.")],
                "days": ["Climate Change & Life", "Match Game — Climate Concepts", "Scenario Challenge — Philippine Ecosystems", "Formative Check — Escape the Climate Lab"],
                "day_descs": ["Learn causes and biological responses to climate change.", "Match climate terms to their definitions.", "Analyze climate impacts on local ecosystems.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("climate-advocate", "Climate Advocate", "🌏")
            },
            10: {
                "title": "Climate Adaptation & Mitigation",
                "competencies": [("GENSCI-11-T2-W10-C1", "Propose adaptation/mitigation for local biodiversity."), ("GENSCI-11-T2-W10-C2", "Evaluate overpopulation effects from secondary sources.")],
                "days": ["Adaptation & Mitigation Strategies", "Match Game — Mitigation Actions", "Scenario Challenge — Community Resilience", "Formative Check — Escape the Resilience Lab"],
                "day_descs": ["Learn how communities adapt to climate change.", "Match each strategy to its climate risk.", "Design mitigation solutions for local communities.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("term2-finisher", "Term 2 Finisher", "🏁")
            }
        }
    },
    "term3": {
        "accent": "#004d40",
        "accent_light": "#26a69a",
        "weeks": {
            1: {
                "title": "Uniqueness of the Planet Earth",
                "competencies": [("GENSCI-11-T3-W1-C1", "Explain Earth's characteristics supporting life vs other planets.")],
                "days": ["Why Earth Supports Life", "Match Game — Earth's Unique Traits", "Scenario Challenge — Comparing Planets", "Formative Check — Escape the Planetarium"],
                "day_descs": ["Learn what makes Earth uniquely habitable.", "Match Earth's traits to their life-support roles.", "Compare Earth to other planets.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("earth-scientist", "Earth Scientist", "🌍")
            },
            2: {
                "title": "Greenhouse Effect & Temperature Regulation",
                "competencies": [("GENSCI-11-T3-W2-C1", "Describe how the greenhouse effect regulates Earth's temperature.")],
                "days": ["The Greenhouse Effect", "Match Game — Greenhouse Gases", "Scenario Challenge — Earth's Thermostat", "Formative Check — Escape the Atmosphere Lab"],
                "day_descs": ["Learn how greenhouse gases keep Earth warm.", "Match gases to their warming potential.", "Analyze temperature-balance scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("atmosphere-pro", "Atmosphere Pro", "🌡️")
            },
            3: {
                "title": "Formation of the Philippine Archipelago",
                "competencies": [("GENSCI-11-T3-W3-C1", "Demonstrate how the Philippine archipelago was formed.")],
                "days": ["How the Philippines Formed", "Match Game — Tectonic Features", "Scenario Challenge — Plate Boundaries", "Formative Check — Escape the Tectonics Lab"],
                "day_descs": ["Learn how plate tectonics built the Philippines.", "Match geological features to their origins.", "Analyze plate-boundary scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("tectonics-explorer", "Tectonics Explorer", "🗻")
            },
            4: {
                "title": "Philippine Landforms, Climate & Biodiversity",
                "competencies": [("GENSCI-11-T3-W4-C1", "Explain unique landforms, climate, and life forms of the Philippines.")],
                "days": ["Landforms, Climate & Life", "Match Game — Philippine Landforms", "Scenario Challenge — Biodiversity Hotspots", "Formative Check — Escape the Biodiversity Lab"],
                "day_descs": ["Explore the Philippines' landforms and climate.", "Match landforms to their regions.", "Analyze biodiversity in local ecosystems.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("biodiversity-pro", "Biodiversity Pro", "🦜")
            },
            5: {
                "title": "Uses of Earth Materials by People",
                "competencies": [("GENSCI-11-T3-W5-C1", "Describe properties and local availability of rocks, minerals, and soils. Explain how they're harnessed for industries.")],
                "days": ["Rocks, Minerals & Soils", "Match Game — Earth Materials", "Scenario Challenge — Industry Uses", "Formative Check — Escape the Geology Lab"],
                "day_descs": ["Learn properties of rocks, minerals, and soils.", "Match materials to their properties.", "Analyze how industries use earth materials.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("geologist", "Geologist", "⛏️")
            },
            6: {
                "title": "Geologic Processes",
                "competencies": [("GENSCI-11-T3-W6-C1", "Describe volcanic eruptions, earthquakes, tsunamis. Describe slow processes: soil erosion, saltwater intrusion.")],
                "days": ["Geologic Processes — Fast & Slow", "Match Game — Geologic Hazards", "Scenario Challenge — Volcanoes & Earthquakes", "Formative Check — Escape the Geohazard Lab"],
                "day_descs": ["Learn fast and slow geologic processes.", "Match hazards to their characteristics.", "Analyze volcanic and seismic scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("geohazard-analyst", "Geohazard Analyst", "🌋")
            },
            7: {
                "title": "Hydrometeorological Processes",
                "competencies": [("GENSCI-11-T3-W7-C1", "Describe typhoons, floods, landslides, storm surges, and heat waves.")],
                "days": ["Weather Hazards in the Philippines", "Match Game — Weather Hazards", "Scenario Challenge — Storm Preparedness", "Formative Check — Escape the Weather Lab"],
                "day_descs": ["Learn about typhoons, floods, and storm surges.", "Match hazards to their warning signs.", "Analyze storm-preparedness scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("weather-pro", "Weather Pro", "🌀")
            },
            8: {
                "title": "Natural Hazards & Human Activities",
                "competencies": [("GENSCI-11-T3-W8-C1", "Describe human modification of landforms since Neolithic (~6,000 BCE)."), ("GENSCI-11-T3-W8-C2", "Assess hazards (tropical cyclones, ipo-ipo, thunderstorms, storm surges, heat waves).")],
                "days": ["Human Impact on Landforms", "Match Game — Hazard Types", "Scenario Challenge — Human-Made Risks", "Formative Check — Escape the Hazard Lab"],
                "day_descs": ["Learn how humans have modified landforms.", "Match hazards to their categories.", "Assess risk in human-modified landscapes.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("hazard-assessor", "Hazard Assessor", "⚠️")
            },
            9: {
                "title": "PAGASA iHEAT & Mitigation",
                "competencies": [("GENSCI-11-T3-W9-C1", "Describe how PAGASA iHEAT maps help Filipinos.")],
                "days": ["PAGASA & iHEAT Maps", "Match Game — PAGASA Products", "Scenario Challenge — Heat Index Awareness", "Formative Check — Escape the PAGASA Lab"],
                "day_descs": ["Learn how PAGASA's iHEAT maps work.", "Match PAGASA products to their uses.", "Analyze heat-index scenarios.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("pagasa-partner", "PAGASA Partner", "☀️")
            },
            10: {
                "title": "DRRM Preparedness & Adaptation",
                "competencies": [("GENSCI-11-T3-W10-C1", "Develop family and community-based DRRM plans.")],
                "days": ["DRRM Planning Basics", "Match Game — DRRM Components", "Scenario Challenge — Family Emergency Plan", "Formative Check — Escape the DRRM Lab"],
                "day_descs": ["Learn the four pillars of DRRM.", "Match each pillar to its actions.", "Build a family emergency plan.", "Prove your mastery — 6 keys, 3 lives."],
                "badge": ("term3-finisher", "Term 3 Finisher", "🏁")
            }
        }
    }
}

# ============================================================
# HTML / JSON TEMPLATES
# ============================================================

WEEK_INDEX_TEMPLATE = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Week {WEEK} — {TITLE} | General Science</title>
  <link rel="stylesheet" href="../../../assets/css/main.css" />
  <link rel="stylesheet" href="../../../assets/css/student.css" />
  <style>
    .week-hero {{ position: relative; background: linear-gradient(135deg, {ACCENT} 0%, {ACCENT} 60%, {ACCENT_LIGHT} 100%); color: #fff; border-radius: 18px; padding: 28px 24px; margin-bottom: 24px; overflow: hidden; box-shadow: 0 8px 24px {ACCENT}40; }}
    .week-hero::before {{ content: ''; position: absolute; top: -60px; right: -60px; width: 200px; height: 200px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); }}
    .week-hero-content {{ position: relative; z-index: 1; }}
    .week-hero-label {{ font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; opacity: 0.85; margin-bottom: 4px; }}
    .week-hero h2 {{ color: #fff; font-size: 1.6rem; margin: 0 0 8px; font-weight: 700; }}
    .week-hero p {{ opacity: 0.92; margin: 0; font-size: 0.9rem; }}
    .week-hero-progress {{ margin-top: 16px; height: 6px; background: rgba(255, 255, 255, 0.2); border-radius: 999px; overflow: hidden; }}
    .week-hero-progress-fill {{ height: 100%; background: #fff; border-radius: 999px; transition: width 0.4s ease; }}
    .day-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-bottom: 24px; }}
    .day-card {{ background: #fff; border-radius: 14px; padding: 18px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); border-top: 4px solid {ACCENT}; text-decoration: none; color: inherit; transition: all 0.2s ease; cursor: pointer; position: relative; display: block; }}
    .day-card:hover {{ transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1); }}
    .day-card.locked {{ opacity: 0.5; cursor: not-allowed; border-top-color: #90a4ae; }}
    .day-card.complete {{ border-top-color: #2e7d32; }}
    .day-card-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }}
    .day-label {{ font-size: 0.72rem; font-weight: 700; color: {ACCENT}; text-transform: uppercase; letter-spacing: 0.5px; }}
    .day-label.green {{ color: #2e7d32; }}
    .day-label.grey {{ color: #90a4ae; }}
    .day-icon {{ font-size: 1.5rem; }}
    .day-title {{ font-size: 0.95rem; font-weight: 600; color: #1a1a1a; margin: 0 0 6px; line-height: 1.3; }}
    .day-desc {{ font-size: 0.78rem; color: #78909c; margin: 0; line-height: 1.4; }}
    .day-meta {{ margin-top: 12px; display: flex; gap: 8px; font-size: 0.72rem; color: #90a4ae; flex-wrap: wrap; }}
    .week-summary {{ background: #fff; border-radius: 14px; padding: 20px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); margin-bottom: 24px; }}
    .week-summary h3 {{ font-size: 1rem; color: {ACCENT}; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }}
    .week-summary h3::before {{ content: ''; width: 4px; height: 18px; background: linear-gradient(180deg, {ACCENT}, {ACCENT_LIGHT}); border-radius: 2px; }}
    .competency-list {{ list-style: none; padding: 0; margin: 0; font-size: 0.88rem; }}
    .competency-list li {{ padding: 8px 0 8px 24px; border-bottom: 1px solid #f5f5f5; position: relative; color: #37474f; line-height: 1.5; }}
    .competency-list li:last-child {{ border-bottom: none; }}
    .competency-list li::before {{ content: '✓'; position: absolute; left: 0; top: 8px; color: {ACCENT_LIGHT}; font-weight: 700; }}
    .competency-code {{ font-family: 'Consolas', monospace; font-size: 0.7rem; color: #90a4ae; background: #f5f7fa; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-left: 6px; }}
  </style>
</head>
<body>

  <header class="app-header">
    <div class="container flex-between">
      <div>
        <h1>🔬 {TERM_LABEL} · Week {WEEK}</h1>
        <span class="version">v1.0.0</span>
      </div>
      <a href="../index.html" class="btn btn-outline" style="color:#fff;border-color:#fff;font-size:0.85rem;">← {TERM_LABEL}</a>
    </div>
  </header>

  <main class="container" style="padding-top:24px;padding-bottom:64px;">

    <div class="week-hero">
      <div class="week-hero-content">
        <div class="week-hero-label">Week {WEEK} of 10</div>
        <h2>{ICON} {TITLE}</h2>
        <p>{DESC}</p>
        <div class="week-hero-progress"><div class="week-hero-progress-fill" id="hero-progress" style="width:0%;"></div></div>
        <p style="margin-top:8px;font-size:0.78rem;opacity:0.85;"><span id="hero-progress-text">0/4 days completed</span></p>
      </div>
    </div>

    <div class="dash-section-title">📚 Learning Competencies</div>
    <div class="week-summary">
      <h3>By the end of this week, you will be able to:</h3>
      <ul class="competency-list" id="competency-list"></ul>
    </div>

    <div class="dash-section-title">📅 Daily Lessons</div>
    <div class="day-grid" id="day-grid"></div>

    <div class="dash-section-title">📊 Weekly Progress</div>
    <div class="week-summary">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <span style="font-weight:600;color:#37474f;">Activities completed</span>
        <span id="week-progress-badge" class="badge badge-info">0/4</span>
      </div>
      <div class="progress-bar" style="height:10px;"><div class="progress-fill" id="week-progress-bar" style="width:0%;"></div></div>
      <p class="text-small text-muted" style="margin-top:12px;" id="week-message">Start Day 1 to begin this week's lessons.</p>
    </div>

  </main>

  <footer class="app-footer"><p>General Science Online Modular Application · <span class="version">v1.0.0</span></p></footer>

  <script src="../../../config.js"></script>
  <script src="../../../assets/js/app.js"></script>
  <script src="../../../assets/js/store.js"></script>
  <script>
    (function() {{
      'use strict';
      const TERM = '{TERM}';
      const WEEK = {WEEK};

      const user = Store.getCurrentUser();
      if (!user) {{ window.location.replace('../../login.html'); return; }}

      const weekMeta = {WEEK_META_JSON};

      const compList = document.getElementById('competency-list');
      weekMeta.competencies.forEach((c) => {{
        const li = document.createElement('li');
        li.innerHTML = `${{c.text}} <span class="competency-code">${{c.code}}</span>`;
        compList.appendChild(li);
      }});

      const progress = Store.getProgress(user.lrn);
      const completed = progress[TERM]?.completed || [];

      function isDayUnlocked(day) {{
        if (day === 1) return true;
        return completed.includes(`${{TERM}}-w${{WEEK}}-d${{day - 1}}`);
      }}

      const grid = document.getElementById('day-grid');
      weekMeta.days.forEach((d) => {{
        const isDone = completed.includes(`${{TERM}}-w${{WEEK}}-d${{d.day}}`);
        const unlocked = isDayUnlocked(d.day);
        const statusClass = isDone ? 'complete' : (unlocked ? '' : 'locked');
        const labelClass = isDone ? 'green' : (unlocked ? '' : 'grey');
        const statusLabel = isDone ? '✓ Complete' : (unlocked ? '▶ Available' : '🔒 Locked');
        const statusIcon = isDone ? '✅' : (unlocked ? d.icon : '🔒');

        const card = document.createElement(unlocked ? 'a' : 'div');
        card.className = `day-card ${{statusClass}}`;
        if (unlocked) card.href = `day.html?d=${{d.day}}`;
        card.innerHTML = `
          <div class="day-card-header">
            <span class="day-label ${{labelClass}}">Day ${{d.day}} · ${{statusLabel}}</span>
            <span class="day-icon">${{statusIcon}}</span>
          </div>
          <h3 class="day-title">${{d.title}}</h3>
          <p class="day-desc">${{d.desc}}</p>
          <div class="day-meta"><span>⏱️ ~30 mins</span><span>🎯 75% to pass</span></div>
        `;
        grid.appendChild(card);
      }});

      const doneCount = weekMeta.days.filter((d) => completed.includes(`${{TERM}}-w${{WEEK}}-d${{d.day}}`)).length;
      const pct = (doneCount / 4) * 100;

      document.getElementById('hero-progress').style.width = `${{pct}}%`;
      document.getElementById('hero-progress-text').textContent = `${{doneCount}}/4 days completed`;
      document.getElementById('week-progress-bar').style.width = `${{pct}}%`;
      document.getElementById('week-progress-badge').textContent = `${{doneCount}}/4`;

      const badge = document.getElementById('week-progress-badge');
      if (doneCount === 4) badge.className = 'badge badge-success';
      else if (doneCount > 0) badge.className = 'badge badge-warning';

      const msg = document.getElementById('week-message');
      if (doneCount === 0) msg.textContent = "Start Day 1 to begin this week's lessons.";
      else if (doneCount === 4) msg.textContent = '🎉 Week complete! You can now move on to Week ' + (WEEK + 1) + '.';
      else msg.textContent = `Keep going! ${{4 - doneCount}} day${{4 - doneCount > 1 ? 's' : ''}} left.`;
    }})();
  </script>
</body>
</html>
'''

DAY_TEMPLATE = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Daily Lesson — General Science</title>
  <link rel="stylesheet" href="../../../assets/css/main.css" />
  <link rel="stylesheet" href="../../../assets/css/student.css" />
  <link rel="stylesheet" href="../../../assets/css/quiz.css" />
</head>
<body>

  <header class="app-header">
    <div class="container flex-between">
      <div>
        <h1 id="header-title">📖 Daily Lesson</h1>
        <span class="version">v1.0.0</span>
      </div>
      <a href="index.html" class="btn btn-outline" style="color:#fff;border-color:#fff;font-size:0.85rem;">← Week</a>
    </div>
  </header>

  <main class="container" style="padding-top:16px;padding-bottom:64px;">
    <div class="daily-score-bar" id="daily-score-bar"></div>

    <div class="card">
      <div id="lesson-content" class="lesson-content">
        <div style="text-align:center;padding:40px;">
          <div style="font-size:2rem;">⏳</div>
          <p class="text-muted">Loading lesson…</p>
        </div>
      </div>
    </div>

    <div id="activities-container">
      <div class="activity-card" id="activity-1-card">
        <div class="activity-header"><span class="activity-title">🔗 Activity 1 — Match the Pairs</span></div>
        <div id="activity-1"></div>
      </div>
      <div class="activity-card" id="activity-2-card">
        <div class="activity-header"><span class="activity-title">🎯 Activity 2 — Scenario Challenge</span></div>
        <div id="activity-2"></div>
      </div>
      <div class="activity-card" id="formative-card">
        <div class="activity-header"><span class="activity-title">🔐 Formative Check — Escape the Lab</span></div>
        <div id="formative"></div>
      </div>
    </div>

    <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;">
      <a id="nav-prev" href="index.html" class="btn btn-outline" style="flex:1;">← Back to Week</a>
      <a id="nav-next" href="index.html" class="btn btn-primary" style="flex:1;">Next Day →</a>
    </div>
  </main>

  <footer class="app-footer"><p>General Science Online Modular Application · <span class="version">v1.0.0</span></p></footer>

  <script src="../../../config.js"></script>
  <script src="../../../assets/js/app.js"></script>
  <script src="../../../assets/js/store.js"></script>
  <script src="../../../assets/js/security.js"></script>
  <script src="../../../assets/js/lesson-engine.js"></script>
  <script src="../../../assets/js/activity-gate.js"></script>
  <script>
    (function() {{
      'use strict';
      const TERM = '{TERM}';
      const WEEK = {WEEK};
      const params = new URLSearchParams(window.location.search);
      const DAY = parseInt(params.get('d') || '1', 10);

      const user = Store.getCurrentUser();
      if (!user) {{ window.location.replace('../../login.html'); return; }}

      document.title = `Week ${{WEEK}} · Day ${{DAY}} — General Science`;
      document.getElementById('header-title').textContent = `📖 Week ${{WEEK}} · Day ${{DAY}}`;

      fetch(`week${{WEEK}}.json`)
        .then((r) => {{ if (!r.ok) throw new Error('Failed to load lesson data'); return r.json(); }})
        .then((data) => {{
          const day = data.days?.find((d) => d.day === DAY);
          if (!day) throw new Error(`Day ${{DAY}} not found in week data`);
          renderLesson(day, data);
        }})
        .catch((err) => {{
          console.error('[Day] Load error:', err);
          document.getElementById('lesson-content').innerHTML = `
            <div style="text-align:center;padding:40px;">
              <div style="font-size:2rem;">⚠️</div>
              <p style="color:#c62828;font-weight:600;">Failed to load lesson</p>
              <p class="text-muted text-small">${{err.message}}</p>
              <button onclick="location.reload()" class="btn btn-primary mt-md">🔄 Retry</button>
            </div>
          `;
        }});

      function renderLesson(day, weekData) {{
        document.getElementById('lesson-content').innerHTML = day.content || '<p>No content available.</p>';

        Lesson.init({{ term: TERM, week: WEEK, day: DAY, title: day.title || `Day ${{DAY}}`, maxPoints: 300 }});

        const badge = day.badge || {{ id: 'scholar', name: 'Scholar', icon: '🏅' }};

        if (day.activities?.match) {{
          Lesson.renderMatchGame('activity-1', {{ pairs: day.activities.match, pointsCorrect: 10, pointsWrong: -3, bonusFast: 15, badgeId: badge.id, badgeName: badge.name, badgeIcon: badge.icon }});
        }} else {{ document.getElementById('activity-1-card').style.display = 'none'; }}

        if (day.activities?.scenario) {{
          Lesson.renderScenarioGame('activity-2', {{ scenarios: day.activities.scenario, pointsCorrect: 8, bonusFast: 3, badgeId: badge.id + '-scenario', badgeName: 'Scenario Solver', badgeIcon: '🎯' }});
        }} else {{ document.getElementById('activity-2-card').style.display = 'none'; }}

        if (day.activities?.escape) {{
          Lesson.renderEscapeRoom('formative', {{ questions: day.activities.escape, lives: 3, badgeId: badge.id + '-escape', badgeName: 'Escape Master', badgeIcon: '🔐' }});
        }} else {{ document.getElementById('formative-card').style.display = 'none'; }}

        const prevBtn = document.getElementById('nav-prev');
        const nextBtn = document.getElementById('nav-next');
        if (DAY > 1) {{ prevBtn.href = `day.html?d=${{DAY - 1}}`; prevBtn.textContent = `← Day ${{DAY - 1}}`; }}
        if (DAY < 4) {{ nextBtn.href = `day.html?d=${{DAY + 1}}`; nextBtn.textContent = `Day ${{DAY + 1}} →`; }}
        else {{ nextBtn.href = 'index.html'; nextBtn.textContent = '✓ Back to Week'; }}
      }}
    }})();
  </script>
</body>
</html>
'''

# ============================================================
# JSON GENERATION (placeholder content — replace with real content)
# ============================================================
def build_week_json(term, week, meta):
    """Build a full week JSON from the CONTENT table.
    Activities are auto-generated placeholders you can swap for real content later."""
    days = []
    for i, (title, desc) in enumerate(zip(meta["days"], meta["day_descs"]), start=1):
        day_obj = {
            "day": i,
            "type": ["lesson", "activity1", "activity2", "formative"][i - 1],
            "title": title,
            "badge": {"id": meta["badge"][0], "name": meta["badge"][1], "icon": meta["badge"][2]},
            "content": f"<h3>🎯 Learning Target</h3><p>{desc}</p><h3>📌 Coming Soon</h3><p>Detailed lesson content for <strong>{title}</strong> will be added here.</p>"
        }
        if i == 2:
            day_obj["activities"] = {"match": [
                {"key": "k1", "left": f"Concept 1 — {title}", "right": "Definition 1"},
                {"key": "k2", "left": f"Concept 2 — {title}", "right": "Definition 2"},
                {"key": "k3", "left": f"Concept 3 — {title}", "right": "Definition 3"},
                {"key": "k4", "left": f"Concept 4 — {title}", "right": "Definition 4"},
                {"key": "k5", "left": f"Concept 5 — {title}", "right": "Definition 5"},
                {"key": "k6", "left": f"Concept 6 — {title}", "right": "Definition 6"},
                {"key": "k7", "left": f"Concept 7 — {title}", "right": "Definition 7"},
                {"key": "k8", "left": f"Concept 8 — {title}", "right": "Definition 8"},
            ]}
        elif i == 3:
            day_obj["activities"] = {"scenario": [
                {"text": f"Scenario {n}: {title}", "choices": [
                    {"label": f"A) Wrong answer {n}", "correct": False},
                    {"label": f"B) Correct answer {n}", "correct": True},
                    {"label": f"C) Wrong answer {n}b", "correct": False},
                    {"label": f"D) Wrong answer {n}c", "correct": False},
                ]} for n in range(1, 6)
            ]}
        elif i == 4:
            day_obj["activities"] = {"escape": [
                {"text": f"Formative question {n} for {title}", "choices": [
                    {"label": f"A) Wrong {n}", "correct": False},
                    {"label": f"B) Correct {n}", "correct": True},
                    {"label": f"C) Wrong {n}b", "correct": False},
                    {"label": f"D) Wrong {n}c", "correct": False},
                ]} for n in range(1, 7)
            ]}
        days.append(day_obj)

    return {
        "term": term,
        "week": week,
        "title": meta["title"],
        "competencies": [{"code": c[0], "text": c[1]} for c in meta["competencies"]],
        "badge": {"id": meta["badge"][0], "name": meta["badge"][1], "icon": meta["badge"][2]},
        "days": days
    }

# ============================================================
# GENERATOR
# ============================================================
def generate_all():
    base = os.path.dirname(os.path.abspath(__file__))
    total = 0

    for term_id, term_data in CONTENT.items():
        term_label = term_id.replace("term", "Term ")
        accent = term_data["accent"]
        accent_light = term_data["accent_light"]

        for week_num, week_meta in term_data["weeks"].items():
            week_dir = os.path.join(base, "student", term_id, f"week{week_num}")
            os.makedirs(week_dir, exist_ok=True)

            # Build weekMeta JSON for the index.html
            week_meta_json = {
                "title": week_meta["title"],
                "competencies": [{"code": c[0], "text": c[1]} for c in week_meta["competencies"]],
                "days": [
                    {
                        "day": i + 1,
                        "type": ["lesson", "activity1", "activity2", "formative"][i],
                        "title": week_meta["days"][i],
                        "desc": week_meta["day_descs"][i],
                        "icon": ["📖", "🔗", "🎯", "🔐"][i]
                    } for i in range(4)
                ]
            }

            # 1. index.html
            icon = week_meta["badge"][2]
            desc = week_meta["competencies"][0][1][:140] + ("..." if len(week_meta["competencies"][0][1]) > 140 else "")
            index_html = WEEK_INDEX_TEMPLATE.format(
                WEEK=week_num,
                TITLE=week_meta["title"],
                ICON=icon,
                DESC=desc,
                TERM=term_id,
                TERM_LABEL=term_label,
                ACCENT=accent,
                ACCENT_LIGHT=accent_light,
                WEEK_META_JSON=json.dumps(week_meta_json, indent=10)
            )
            with open(os.path.join(week_dir, "index.html"), "w", encoding="utf-8") as f:
                f.write(index_html)
            total += 1

            # 2. day.html
            day_html = DAY_TEMPLATE.format(TERM=term_id, WEEK=week_num)
            with open(os.path.join(week_dir, "day.html"), "w", encoding="utf-8") as f:
                f.write(day_html)
            total += 1

            # 3. weekN.json
            week_json = build_week_json(term_id, week_num, week_meta)
            with open(os.path.join(week_dir, f"week{week_num}.json"), "w", encoding="utf-8") as f:
                json.dump(week_json, f, indent=2, ensure_ascii=False)
            total += 1

            print(f"  ✓ {term_id}/week{week_num}/  (index.html, day.html, week{week_num}.json)")

    print(f"\n✅ Generated {total} files across 30 weeks.")
    print(f"📁 Output folder: {base}/student/")

if __name__ == "__main__":
    print("🔬 Building General Science week files...\n")
    generate_all()