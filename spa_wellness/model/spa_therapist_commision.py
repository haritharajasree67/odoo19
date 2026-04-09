from odoo import api, fields, models

class SpaTherapistCommission(models.Model):
    _name = 'spa.therapist.commission'
    _description = 'Therapist Commission'
    _order = 'id desc'

    appointment_id = fields.Many2one(
        'spa.appointment',
        required=True,
        ondelete='cascade'
    )

    therapist_id = fields.Many2one(
        'spa.therapist',
        required=True
    )

    service_id = fields.Many2one(
        'spa.service',
        required=True
    )

    service_amount = fields.Monetary()
    commission_type = fields.Selection([
        ('percentage', 'Percentage'),
        ('fixed', 'Fixed')
    ])

    commission_value = fields.Float()

    commission_amount = fields.Monetary()

    currency_id = fields.Many2one(
        'res.currency',
        default=lambda self: self.env.company.currency_id
    )

    @api.model
    def get_commission_data(self, date_from=False, date_to=False, therapist_id=False):
        domain = []
        if therapist_id:
            domain.append(('therapist_id', '=', int(therapist_id)))
        if date_from:
            domain.append(('appointment_id.start_datetime', '>=', date_from))
        if date_to:
            domain.append(('appointment_id.start_datetime', '<=', date_to))
        records = self.search(domain)

        result = []
        for rec in records:
            result.append({
                'appointment': rec.appointment_id.name,
                'therapist': rec.therapist_id.name,
                'service': rec.service_id.name,
                'service_amount': rec.service_amount,
                'commission_type': rec.commission_type,
                'commission_value': rec.commission_value,
                'commission_amount': rec.commission_amount,
            })

        return result

    @api.model
    def get_therapists(self):
        therapists = self.env['spa.therapist'].search([])
        return [{
            'id': t.id,
            'name': t.name
        } for t in therapists]
