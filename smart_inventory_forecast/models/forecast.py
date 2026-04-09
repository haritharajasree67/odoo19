from odoo import models, api, fields
from datetime import timedelta

class InventoryForecast(models.Model):
    _name = "inventory.forecast"
    _description = "Inventory Forecast"

    @api.model
    def get_top_products(self):
        date_from = fields.Date.today() - timedelta(days=90)

        query = """
            SELECT sol.product_id,
                   SUM(sol.product_uom_qty) as total_qty
            FROM sale_order_line sol
            JOIN sale_order so ON sol.order_id = so.id
            WHERE so.state IN ('sale','done')
            AND so.date_order >= %s
            GROUP BY sol.product_id
            ORDER BY total_qty DESC
            LIMIT 5
        """

        self.env.cr.execute(query, (date_from,))
        result = self.env.cr.dictfetchall()

        data = []
        for rec in result:
            product = self.env['product.product'].browse(rec['product_id'])
            data.append({
                "product": product.display_name,
                "qty": rec['total_qty']
            })

        return data

    @api.model
    def get_dead_stock(self):
        date_from = fields.Date.today() - timedelta(days=90)

        # Single query: fetch all product IDs that had sales in the window
        sold_lines = self.env['sale.order.line'].search([
            ('order_id.state', 'in', ['sale', 'done']),
            ('order_id.date_order', '>=', date_from)
        ])
        sold_ids = set(sold_lines.mapped('product_id.id'))

        # Filter in-stock products not in the sold set
        products = self.env['product.product'].search([
            ('qty_available', '>', 0)
        ])

        return [
            {"product": p.display_name, "stock": p.qty_available}
            for p in products if p.id not in sold_ids
        ]

    @api.model
    def purchase_suggestion(self):
        date_from = fields.Date.today() - timedelta(days=90)

        # Single query: fetch all relevant sale lines in the window
        lines = self.env['sale.order.line'].search([
            ('order_id.state', 'in', ['sale', 'done']),
            ('order_id.date_order', '>=', date_from)
        ])

        # Aggregate quantities per product in Python
        qty_by_product = {}
        for line in lines:
            pid = line.product_id.id
            qty_by_product[pid] = qty_by_product.get(pid, 0) + line.product_uom_qty

        result = []
        for pid, total_qty in qty_by_product.items():
            product = self.env['product.product'].browse(pid)
            forecast = total_qty / 3
            if forecast > product.qty_available:
                result.append({
                    "product": product.display_name,
                    "forecast": round(forecast, 2),
                    "stock": product.qty_available,
                    "purchase": round(forecast - product.qty_available, 2)
                })

        return result