// jigsaw2pdf: assembles Scribd "jigsaw" pages into a PDF without re-encoding any image.
//
// Scribd renders a page as absolutely positioned <img> pieces, each showing a CSS clip rect
// of a shared JPEG sheet. The PDF embeds every sheet once as a DCTDecode passthrough and
// draws each piece as a clipped placement of that sheet, so output is lossless and small.
//
// Usage: jigsaw2pdf <layout.txt> <out.pdf>
//
// Layout is one whitespace separated record per line, in CSS px:
//   page <width> <height>
//   img <path> <left> <top> <width> <height> <clipTop> <clipRight> <clipBottom> <clipLeft>
// img records belong to the preceding page and are drawn in order (later on top).
// Relative paths resolve against the layout file's directory.

#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PX_TO_PT 0.75 // CSS px are 1/96 in, PDF points are 1/72 in

typedef struct {
    int image;
    double left, top, width, height;
    double clip_top, clip_right, clip_bottom, clip_left;
} Piece;

typedef struct {
    double width, height;
    int first_piece, piece_count;
} Page;

typedef struct {
    char *data;
    size_t len, cap;
} Buf;

static Piece *pieces;
static int piece_count, piece_cap;
static Page *pages;
static int page_count, page_cap;
static char **images; // unique sheet paths, index = XObject number
static int image_count, image_cap;

static void die(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    fputs("jigsaw2pdf: ", stderr);
    vfprintf(stderr, fmt, ap);
    fputc('\n', stderr);
    va_end(ap);
    exit(1);
}

static void *grow(void *p, int *cap, size_t elem) {
    *cap = *cap ? *cap * 2 : 64;
    p = realloc(p, (size_t)*cap * elem);
    if (!p) die("out of memory");
    return p;
}

static void buf_printf(Buf *b, const char *fmt, ...) {
    for (;;) {
        va_list ap;
        va_start(ap, fmt);
        int n = vsnprintf(b->data + b->len, b->cap - b->len, fmt, ap);
        va_end(ap);
        if (n < 0) die("format error");
        if (b->len + (size_t)n < b->cap) {
            b->len += (size_t)n;
            return;
        }
        b->cap = (b->cap + (size_t)n + 1) * 2;
        b->data = realloc(b->data, b->cap);
        if (!b->data) die("out of memory");
    }
}

// Shortest decimal for a coordinate: layouts are whole px, so this is usually an integer.
static void buf_num(Buf *b, double v) {
    char s[32];
    snprintf(s, sizeof s, "%.4f", v);
    char *end = s + strlen(s) - 1;
    while (*end == '0') *end-- = '\0';
    if (*end == '.') *end = '\0';
    if (strcmp(s, "-0") == 0) strcpy(s, "0");
    buf_printf(b, "%s ", s);
}

static int intern_image(const char *path) {
    // Pieces of one page share a sheet, so checking newest first is almost always a hit.
    for (int i = image_count - 1; i >= 0; i--)
        if (strcmp(images[i], path) == 0) return i;
    if (image_count == image_cap) images = grow(images, &image_cap, sizeof *images);
    images[image_count] = strdup(path);
    if (!images[image_count]) die("out of memory");
    return image_count++;
}

static void parse_layout(const char *layout_path) {
    FILE *f = fopen(layout_path, "r");
    if (!f) die("cannot open %s: %s", layout_path, strerror(errno));

    char dir[4096] = "";
    const char *slash = strrchr(layout_path, '/');
    if (slash) snprintf(dir, sizeof dir, "%.*s/", (int)(slash - layout_path), layout_path);

    char line[8192], kind[16], path[4096], full[8192];
    for (int lineno = 1; fgets(line, sizeof line, f); lineno++) {
        if (sscanf(line, "%15s", kind) != 1) continue; // blank line
        if (strcmp(kind, "page") == 0) {
            if (page_count == page_cap) pages = grow(pages, &page_cap, sizeof *pages);
            Page *p = &pages[page_count];
            if (sscanf(line, "%*s %lf %lf", &p->width, &p->height) != 2 || p->width <= 0 || p->height <= 0)
                die("%s:%d: bad page record", layout_path, lineno);
            p->first_piece = piece_count;
            p->piece_count = 0;
            page_count++;
        } else if (strcmp(kind, "img") == 0) {
            if (!page_count) die("%s:%d: img before any page", layout_path, lineno);
            if (piece_count == piece_cap) pieces = grow(pieces, &piece_cap, sizeof *pieces);
            Piece *pc = &pieces[piece_count];
            if (sscanf(line, "%*s %4095s %lf %lf %lf %lf %lf %lf %lf %lf", path, &pc->left, &pc->top,
                       &pc->width, &pc->height, &pc->clip_top, &pc->clip_right, &pc->clip_bottom,
                       &pc->clip_left) != 9)
                die("%s:%d: bad img record", layout_path, lineno);
            snprintf(full, sizeof full, "%s%s", path[0] == '/' ? "" : dir, path);
            pc->image = intern_image(full);
            pages[page_count - 1].piece_count++;
            piece_count++;
        } else {
            die("%s:%d: unknown record '%s'", layout_path, lineno, kind);
        }
    }
    fclose(f);
    if (!page_count) die("%s: no pages", layout_path);
}

static unsigned char *read_file(const char *path, size_t *len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    unsigned char *data = n > 0 ? malloc((size_t)n) : NULL;
    if (data && fread(data, 1, (size_t)n, f) != (size_t)n) {
        free(data);
        data = NULL;
    }
    fclose(f);
    *len = (size_t)n;
    return data;
}

// Reads dimensions and component count from the JPEG's start-of-frame marker.
static int jpeg_info(const unsigned char *d, size_t len, int *w, int *h, int *comps) {
    if (len < 4 || d[0] != 0xFF || d[1] != 0xD8) return 0;
    size_t i = 2;
    while (i + 4 <= len) {
        if (d[i] != 0xFF) return 0;
        while (i < len && d[i] == 0xFF) i++; // fill bytes
        if (i >= len) return 0;
        unsigned char m = d[i++];
        if (m == 0xD8 || m == 0x01 || (m >= 0xD0 && m <= 0xD7)) continue; // no length field
        if (i + 2 > len) return 0;
        size_t seg = (size_t)d[i] << 8 | d[i + 1];
        int is_sof = m >= 0xC0 && m <= 0xCF && m != 0xC4 && m != 0xC8 && m != 0xCC;
        if (is_sof) {
            if (i + 8 > len) return 0;
            *h = d[i + 3] << 8 | d[i + 4];
            *w = d[i + 5] << 8 | d[i + 6];
            *comps = d[i + 7];
            return *w > 0 && *h > 0;
        }
        i += seg;
    }
    return 0;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: jigsaw2pdf <layout.txt> <out.pdf>\n");
        return 2;
    }
    parse_layout(argv[1]);

    // Object numbers: 1 catalog, 2 page tree, 3 shared resources, then one per sheet,
    // then a page object and its content stream for each page.
    const int first_image_obj = 4;
    const int first_page_obj = first_image_obj + image_count;
    const int obj_count = first_page_obj + 2 * page_count;
    long *offsets = calloc((size_t)obj_count, sizeof *offsets);
    if (!offsets) die("out of memory");

    char tmp_path[8192];
    snprintf(tmp_path, sizeof tmp_path, "%s.tmp", argv[2]);
    FILE *out = fopen(tmp_path, "wb");
    if (!out) die("cannot write %s: %s", tmp_path, strerror(errno));
    fputs("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", out);

    int missing = 0;
    for (int i = 0; i < image_count; i++) {
        size_t len;
        int w, h, comps;
        unsigned char *jpeg = read_file(images[i], &len);
        if (!jpeg || !jpeg_info(jpeg, len, &w, &h, &comps) || (comps != 1 && comps != 3 && comps != 4)) {
            fprintf(stderr, "jigsaw2pdf: %s: %s\n", images[i], jpeg ? "not a usable JPEG" : strerror(errno));
            missing++;
            free(jpeg);
            continue;
        }
        const char *space = comps == 1 ? "/DeviceGray" : comps == 3 ? "/DeviceRGB" : "/DeviceCMYK";
        // 4-component JPEGs come from Adobe tools, which store CMYK inverted.
        const char *decode = comps == 4 ? " /Decode [1 0 1 0 1 0 1 0]" : "";
        offsets[first_image_obj + i] = ftell(out);
        fprintf(out,
                "%d 0 obj\n<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s"
                " /BitsPerComponent 8%s /Filter /DCTDecode /Length %zu >>\nstream\n",
                first_image_obj + i, w, h, space, decode, len);
        fwrite(jpeg, 1, len, out);
        fputs("\nendstream\nendobj\n", out);
        free(jpeg);
    }
    if (missing) {
        fclose(out);
        remove(tmp_path);
        die("%d of %d image sheets missing or unreadable, no PDF written", missing, image_count);
    }

    Buf b = {0};
    offsets[3] = ftell(out);
    buf_printf(&b, "3 0 obj\n<< /XObject <<");
    for (int i = 0; i < image_count; i++) buf_printf(&b, " /Im%d %d 0 R", i, first_image_obj + i);
    buf_printf(&b, " >> >>\nendobj\n");
    fwrite(b.data, 1, b.len, out);

    Buf content = {0};
    for (int p = 0; p < page_count; p++) {
        const Page *pg = &pages[p];
        int page_obj = first_page_obj + 2 * p, content_obj = page_obj + 1;

        // Work in CSS px with a top-left origin, like the browser.
        content.len = 0;
        buf_printf(&content, "%g 0 0 %g 0 ", PX_TO_PT, -PX_TO_PT);
        buf_num(&content, pg->height * PX_TO_PT);
        buf_printf(&content, "cm\n");
        for (int k = 0; k < pg->piece_count; k++) {
            const Piece *pc = &pieces[pg->first_piece + k];
            // CSS clip rect edges are offsets from the element's top-left, limited to its box.
            double x0 = pc->left + (pc->clip_left > 0 ? pc->clip_left : 0);
            double x1 = pc->left + (pc->clip_right < pc->width ? pc->clip_right : pc->width);
            double y0 = pc->top + (pc->clip_top > 0 ? pc->clip_top : 0);
            double y1 = pc->top + (pc->clip_bottom < pc->height ? pc->clip_bottom : pc->height);
            if (x1 <= x0 || y1 <= y0) continue;
            buf_printf(&content, "q ");
            buf_num(&content, x0);
            buf_num(&content, y0);
            buf_num(&content, x1 - x0);
            buf_num(&content, y1 - y0);
            // An image fills the unit square from its bottom-left corner, so map that onto
            // the element box, flipped because this space grows downward.
            buf_printf(&content, "re W n ");
            buf_num(&content, pc->width);
            buf_printf(&content, "0 0 ");
            buf_num(&content, -pc->height);
            buf_num(&content, pc->left);
            buf_num(&content, pc->top + pc->height);
            buf_printf(&content, "cm /Im%d Do Q\n", pc->image);
        }

        offsets[page_obj] = ftell(out);
        fprintf(out, "%d 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %g %g] /Resources 3 0 R /Contents %d 0 R >>\nendobj\n",
                page_obj, pg->width * PX_TO_PT, pg->height * PX_TO_PT, content_obj);
        offsets[content_obj] = ftell(out);
        fprintf(out, "%d 0 obj\n<< /Length %zu >>\nstream\n", content_obj, content.len);
        fwrite(content.data, 1, content.len, out);
        fputs("\nendstream\nendobj\n", out);
    }

    offsets[2] = ftell(out);
    fprintf(out, "2 0 obj\n<< /Type /Pages /Count %d /Kids [", page_count);
    for (int p = 0; p < page_count; p++) fprintf(out, " %d 0 R", first_page_obj + 2 * p);
    fputs(" ] >>\nendobj\n", out);
    offsets[1] = ftell(out);
    fputs("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", out);

    long xref = ftell(out);
    fprintf(out, "xref\n0 %d\n0000000000 65535 f \n", obj_count);
    for (int i = 1; i < obj_count; i++) fprintf(out, "%010ld 00000 n \n", offsets[i]);
    fprintf(out, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%ld\n%%%%EOF\n", obj_count, xref);

    if (ferror(out) | fclose(out)) die("write to %s failed", tmp_path);
    if (rename(tmp_path, argv[2]) != 0) die("cannot rename %s: %s", tmp_path, strerror(errno));
    printf("jigsaw2pdf: wrote %d pages, %d pieces, %d image sheets to %s\n", page_count, piece_count, image_count, argv[2]);
    return 0;
}
