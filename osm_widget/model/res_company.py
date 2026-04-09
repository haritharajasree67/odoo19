from odoo import models, fields, api
import logging

_logger = logging.getLogger(__name__)

class HrWorkLocation(models.Model):
    _inherit = "hr.work.location"


    location_map = fields.Char(string="Location")
    latitude = fields.Float(string="Latitude", digits=(10, 7))
    longitude = fields.Float(string="Longitude", digits=(10, 7))
    radius = fields.Float(string='Radius', digits=(10, 7))

    @staticmethod
    def _parse_location_map(value):
        """Parse 'lat,lng' string → (float, float) or (0.0, 0.0)."""
        try:
            parts = (value or '').split(',')
            if len(parts) == 2:
                return float(parts[0].strip()), float(parts[1].strip())
        except (ValueError, TypeError):
            pass
        return 0.0, 0.0

    # ── Override create & write so lat/lng are ALWAYS written to the DB ───────

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if 'location_map' in vals and vals['location_map']:
                lat, lng = self._parse_location_map(vals['location_map'])
                vals['latitude'] = lat
                vals['longitude'] = lng
        return super().create(vals_list)

    def write(self, vals):
        if 'location_map' in vals and vals['location_map']:
            lat, lng = self._parse_location_map(vals['location_map'])
            vals['latitude'] = lat
            vals['longitude'] = lng
        return super().write(vals)

    # ── onchange: updates the float fields live in the form (UI only) ─────────

    @api.onchange('location_map')
    def _onchange_location_map(self):
        for rec in self:
            lat, lng = self._parse_location_map(rec.location_map)
            rec.latitude = lat
            rec.longitude = lng