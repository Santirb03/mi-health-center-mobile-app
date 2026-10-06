export interface BusinessReceiptConfig {
  name: string;
  address: string;
  phone: string;
  email: string;
  legend: string;
}

// Los campos de contacto vacíos no se muestran. El dueño debe revisar la leyenda
// y completar los datos reales del negocio antes de producción.
export const BUSINESS_RECEIPT: BusinessReceiptConfig = {
  name: "Mi Health Center",
  address: "",
  phone: "",
  email: "",
  legend: "Este comprobante es informativo y no constituye una factura fiscal (CFDI).",
};
