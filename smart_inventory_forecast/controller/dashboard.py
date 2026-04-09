from odoo import http
from odoo.http import request

class ForecastDashboardController(http.Controller):

    @http.route('/inventory_forecast/data', type='json', auth='user')
    def get_dashboard_data(self):
        forecast = request.env['inventory.forecast']

        return {
            "top_products": forecast.get_top_products(),
            "dead_stock": forecast.get_dead_stock(),
            "purchase": forecast.purchase_suggestion(),
        }