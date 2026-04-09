.. image:: https://img.shields.io/badge/licence-LGPL--3-blue.svg
   :target: http://www.gnu.org/licenses/lgpl-3.0-standalone.html
   :alt: License: LGPL-3

.. image:: https://img.shields.io/badge/Odoo-18.0-blueviolet
   :alt: Odoo Version: 19.0

============================
Inventory Forecast Dashboard
============================

A powerful, multi-tab Business Intelligence dashboard built as a native Odoo 18 OWL component.
It provides real-time insights across inventory, purchasing, manufacturing, and product analytics
— all from a single client-action interface inside the Inventory module.

.. contents:: Table of Contents
   :depth: 2
   :local:

Features
========

- **Demand Chart** — Interactive sales demand visualization with Chart.js
- **Purchase Suggestions** — Smart reorder detection with one-click PO drafting
- **Dead Stock Detection** — Identify slow-moving inventory with severity levels
- **Seasonal Forecasting** — 12-month demand forecast based on historical patterns
- **Product Analytics** — Revenue, COGS, Tax, and Gross Margin per product
- **Manufacturing Intelligence** — Production orders, BoM stock check, and component shortages *(requires MRP module)*

Installation
============

Requirements
------------

- Odoo **19.0**
- Python 3.10+
- ``stock`` module (standard Odoo Inventory)
- ``mrp`` module *(optional — Manufacturing tab is hidden if not installed)*

Steps
-----

1. Copy the ``inventory_forecast_dashboard`` folder into your Odoo addons directory:

   .. code-block:: bash

      cp -r inventory_forecast_dashboard /path/to/odoo/addons/

2. Restart the Odoo server:

   .. code-block:: bash

      ./odoo-bin -c odoo.conf --stop-after-init

3. Activate Developer Mode:
   ``Settings → General Settings → Developer Tools → Activate the developer mode``

4. Update the Apps list:
   ``Apps → Update Apps List``

5. Search for **Inventory Forecast Dashboard** and click **Install**.

6. Navigate to **Inventory → Reporting → Forecast Dashboard** to open the dashboard.

Configuration
=============

No additional configuration is required after installation. The dashboard reads live data
directly from existing Odoo models via JSON-RPC.

Optional settings available within the dashboard UI:

- **Date range filters** on Demand, Seasonal, and Manufacturing tabs
- **Top-N product selector** (5, 10, 20, or All) on the Demand Chart
- **Gross Margin threshold** for the Product Analytics badge (default: 20%)

Tab Reference
=============

Demand Chart
------------

Visualizes confirmed sales demand per product. Supports Pie, Bar, and Doughnut chart types.

- **Data source:** ``sale.order.line`` (states: ``confirmed``, ``sale``)
- **Filters:** Date From / Date To, Top-N products
- **Export:** XLSX download via SheetJS

Purchase Suggestions
--------------------

Identifies products that have fallen below their reorder point and groups them by vendor.

- **Data sources:** ``product.product``, ``stock.warehouse.orderpoint``, ``product.supplierinfo``
- **Logic:** ``qty_available < product_min_qty`` → flag for reorder
- **Suggested qty:** ``product_max_qty - qty_available``
- **Action:** Auto-create draft Purchase Orders per vendor group

Dead Stock
----------

Detects products with on-hand stock but zero confirmed sales in the past 12 months.

- **Data sources:** ``sale.order.line`` (last 365 days), ``stock.quant``
- **Severity levels:**

  +----------+-----------------------------------------------------+
  | Level    | Condition                                           |
  +==========+=====================================================+
  | Critical | On-hand value > 10,000 OR quantity > 500 units      |
  +----------+-----------------------------------------------------+
  | High     | On-hand value between 5,000 and 10,000              |
  +----------+-----------------------------------------------------+
  | Medium   | On-hand value between 1,000 and 5,000               |
  +----------+-----------------------------------------------------+
  | Low      | On-hand value below 1,000                           |
  +----------+-----------------------------------------------------+

Seasonal Forecast
-----------------

Calculates monthly seasonal demand indices from 24 months of sales history and projects
the next 12 months.

- **Data source:** ``sale.order.line`` (last 24 months)
- **Formula:** ``Seasonal Index (M) = Avg demand in month M / Overall monthly average``
- **Guards:** Spike cap at 5× median index; clearance pattern smoothing
- **Display:** Bar chart per product or in aggregate

Product Analytics
-----------------

Breaks down financial performance per product across Revenue, Tax, COGS, and Gross Margin.

- **Data sources:** ``sale.order.line``, ``account.move.line``, ``stock.valuation.layer``, ``product.template``
- **Formula:** ``Gross Margin % = ((Revenue - COGS) / Revenue) × 100``
- **Alerts:** Products with negative margin highlighted in red; badge shows products below threshold
- **Export:** XLSX download

Manufacturing *(requires MRP module)*
--------------------------------------

Conditionally shown only when the ``mrp`` module is installed. Contains three sub-tabs:

**Production Orders**
  All manufacturing orders with status badges and overdue detection.

  +------------+---------------------+
  | State      | Badge               |
  +============+=====================+
  | draft      | Gray (Secondary)    |
  +------------+---------------------+
  | confirmed  | Blue (Primary)      |
  +------------+---------------------+
  | progress   | Yellow (Warning)    |
  +------------+---------------------+
  | to_close   | Teal (Info)         |
  +------------+---------------------+
  | done       | Green (Success)     |
  +------------+---------------------+

**BoM Stock Check**
  Shows how many units can be produced right now with current component stock.

  - **Ready** (green) — All components sufficient
  - **Partial** (yellow) — Some components short
  - **Blocked** (red) — At least one component has zero stock

**Component Shortages**
  Raw material ``stock.move`` lines where reserved quantity is less than required
  for confirmed or in-progress manufacturing orders.

  +----------+------------------------------+
  | Severity | Missing Quantity             |
  +==========+==============================+
  | High     | More than 50 units missing   |
  +----------+------------------------------+
  | Medium   | Between 10 and 50 missing    |
  +----------+------------------------------+
  | Low      | Fewer than 10 units missing  |
  +----------+------------------------------+

Technical Notes
===============

Architecture
------------

- Built as a native **OWL (Owl Web Library)** component for Odoo 18
- Registered as a **client action** — no server-side Python controller required
- All data fetched live via ``/web/dataset/call_kw`` using ``@web/core/network/rpc``
- State managed via OWL ``useState``; active tab and filters persisted to ``localStorage``

Odoo 18 Field Name Changes
--------------------------

This module uses the updated field names introduced in Odoo 18:

+---------------------------+-----------------+------------------------+
| Model                     | Old Name        | New Name (Odoo 18)     |
+===========================+=================+========================+
| ``mrp.production``        | date_planned_start | date_start          |
+---------------------------+-----------------+------------------------+
| ``mrp.production``        | date_planned_finished | date_finished    |
+---------------------------+-----------------+------------------------+
| ``stock.move``            | reserved_availability | quantity         |
+---------------------------+-----------------+------------------------+

.. warning::

   Using the old field names will raise a ``ValueError`` on the server.
   Do not revert to the legacy names.

Manufacturing Module Guard
--------------------------

Before making any RPC call to ``mrp.*`` models, the dashboard verifies that the
``mrp`` module is installed:

.. code-block:: javascript

   // model: ir.module.module
   // domain: [['name','=','mrp'],['state','=','installed']]

If the module is not installed, ``state.mfgModuleInstalled`` remains ``false``,
the Manufacturing tab is hidden, and no further RPC calls to MRP models are made.
This prevents 404 RPC errors that would crash the entire dashboard on non-manufacturing instances.

Dependencies
============

+---------------------+--------------------------------------------------+
| Library             | Purpose                                          |
+=====================+==================================================+
| Chart.js (CDN)      | Demand and Seasonal Forecast chart rendering     |
+---------------------+--------------------------------------------------+
| SheetJS (CDN)       | XLSX export for Demand and Analytics tabs        |
+---------------------+--------------------------------------------------+
| Bootstrap           | Tab navigation and badge UI (bundled with Odoo) |
+---------------------+--------------------------------------------------+

Odoo Module Dependencies
------------------------

.. code-block:: python

   'depends': ['stock', 'sale', 'purchase', 'account', 'mrp'],
   # mrp is optional — guarded at runtime

Known Limitations
=================

- The dashboard does not support **multi-company** filtering in the current version.
- XLSX exports use client-side generation; very large datasets (50,000+ lines) may be slow.
- The Manufacturing tab requires ``mrp`` to be fully installed, not just listed as a dependency.

Changelog
=========

18.0.1.0.0 (Initial Release)
-----------------------------

- Demand Chart with Pie/Bar/Doughnut and XLSX export
- Purchase Suggestions with auto-draft PO creation
- Dead Stock detection with severity classification
- Seasonal Forecast with spike and clearance pattern guards
- Product Analytics with margin alerting and XLSX export
- Manufacturing tab with Production Orders, BoM Stock Check, and Component Shortages
- MRP module guard to support non-manufacturing Odoo instances
- ``localStorage`` state persistence for tab and filter state

Bug Tracker
===========

Bugs can be reported via your internal issue tracker. When reporting, please include:

- Odoo version and edition (Community / Enterprise)
- Browser and version
- Steps to reproduce
- Screenshot or browser console error if applicable

Authors
=======

- https://www.diodeinfosolutions.com/



License
=======

This module is licensed under the **GNU Lesser General Public License v3 or later (LGPLv3+)**.

See `LICENSE <LICENSE>`__ file for full license text.