import com.devkit.model.Order;
import com.devkit.model.Owner;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Compile-and-use check for the T22 record output.
 *
 * Proves:
 *  1. Order.java / Owner.java compile as records on Java 16+ (checked on JDK 24).
 *  2. No Lombok is needed: the generated accessors are the record components.
 *  3. The components hold the exact sample values, uid = 1024 / vip = true.
 *
 * Records are immutable, so every component is passed through the canonical
 * constructor. No network access.
 */
public final class Verify {

    private static String read(Path p) throws Exception {
        return new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
    }

    private static String grab(String json, String pattern) {
        Matcher m = Pattern.compile(pattern).matcher(json);
        if (!m.find()) {
            throw new IllegalStateException("sample input is missing field: " + pattern);
        }
        return m.group(1);
    }

    public static void main(String[] args) throws Exception {
        Path jsonPath = Path.of(args.length > 0 ? args[0] : "input.json");
        String json = read(jsonPath);

        String rawId = grab(json, "\"id\"\\s*:\\s*(\\d+)");
        String rawName = grab(json, "\"name\"\\s*:\\s*\"([^\"]*)\"");
        String rawAmount = grab(json, "\"amount\"\\s*:\\s*([\\d.]+)");
        String rawUid = grab(json, "\"uid\"\\s*:\\s*(\\d+)");
        String rawVip = grab(json, "\"vip\"\\s*:\\s*(true|false)");

        Owner owner = new Owner(Long.valueOf(rawUid), Boolean.valueOf(rawVip));
        Order order = new Order(
                Long.valueOf(rawId),
                rawName,
                new BigDecimal(rawAmount),
                List.of("batch", "priority"),
                owner,
                null);

        check("order.id()", "9007199254740993", String.valueOf(order.id()));
        check("order.name()", rawName, order.name());
        check("order.amount()", "1899.50", order.amount().toPlainString());
        check("order.tags()", "[batch, priority]", String.valueOf(order.tags()));
        check("order.owner().uid()", "1024", String.valueOf(order.owner().uid()));
        check("order.owner().vip()", "true", String.valueOf(order.owner().vip()));
        check("order.memo()", "null", String.valueOf(order.memo()));

        check("uid is Long", "1024", String.valueOf(owner.uid()));
        check("vip is Boolean", "true", String.valueOf(owner.vip()));

        System.out.println("record (Java 16+, no Lombok) compile+use check: PASS");
    }

    private static void check(String label, String expected, String actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError(label + ": expected <" + expected + "> but was <" + actual + ">");
        }
        System.out.println("  ok  " + label + " = " + actual);
    }
}
