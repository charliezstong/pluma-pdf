# Marca de Pluma PDF

Una pluma blanca sobre azul: una referencia sencilla a escribir y a hacer más livianos los documentos. El corte diagonal mantiene el símbolo legible en tamaños pequeños.

## Archivos

- `assets/brand/icon.svg`: icono vectorial con fondo azul y esquinas redondeadas.
- `assets/brand/icon-128.png`, `icon-256.png`, `icon-512.png`: versiones PNG del mismo SVG.
- `assets/brand/mark.svg`: símbolo azul sin fondo.
- `assets/brand/cover.svg` y `cover.png`: portada del repositorio.
- `assets/brand/preview.png`: captura del plugin con el documento sintético integrado.

El icono integrado en el plugin conserva la misma geometría que el SVG. Los PNG se generan desde los vectores con Sharp; no son ampliaciones de un bitmap.

## Dirección visual

Icono minimalista y elegante para Pluma PDF, una herramienta local de exportación. Fondo azul uniforme, una sola pluma blanca de formas limpias, sin texto dentro del símbolo, sin sombras, sin efectos tridimensionales. Legible como icono pequeño y coherente con la interfaz vertical en gris oscuro.

Se exploró el concepto mediante generación de imágenes. La versión final se construyó en SVG para controlar la forma, los bordes y la reproducción en distintos tamaños. La portada y todos los recursos de esta carpeta son material de marca del proyecto; no contienen diseños ni imágenes de clientes.

## Colores

| Uso | Color |
| --- | --- |
| Azul del icono | `#0A84FF` |
| Pluma y texto principal | `#FFFFFF` |
| Fondo de portada | `#222225` |
| Texto secundario | `#B7B7BE` |

Conserva espacio libre alrededor del símbolo y su proporción cuadrada. Usa el SVG para escalar y los PNG para plataformas que requieren imágenes rasterizadas.
