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
 * Compile-and-use check for the T22 POJO output (Lombok variant).
 *
 * Proves three things that the design board only claims in text:
 *  1. Order.java / Owner.java compile as written on the board.
 *  2. Lombok @Data actually generates the accessors the UI implies.
 *  3. The generated field types can hold the exact sample values,
 *     including uid = 1024 (Long) and vip = true (Boolean).
 *
 * This does NOT send any HTTP request and does NOT touch the network.
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

        Owner owner = new Owner();
        owner.setUid(Long.valueOf(rawUid));
        owner.setVip(Boolean.valueOf(rawVip));

        Order order = new Order();
        order.setId(Long.valueOf(rawId));
        order.setName(rawName);
        order.setAmount(new BigDecimal(rawAmount));
        order.setTags(List.of("batch", "priority"));
        order.setOwner(owner);
        order.setMemo(null);

        check("order.getId()", "9007199254740993", String.valueOf(order.getId()));
        check("order.getName()", rawName, order.getName());
        check("order.getAmount()", "1899.50", order.getAmount().toPlainString());
        check("order.getTags()", "[batch, priority]", String.valueOf(order.getTags()));
        check("order.getOwner().getUid()", "1024", String.valueOf(order.getOwner().getUid()));
        check("order.getOwner().getVip()", "true", String.valueOf(order.getOwner().getVip()));
        check("order.getMemo()", "null", String.valueOf(order.getMemo()));

        check("uid is Long", "1024", String.valueOf(owner.getUid()));
        check("vip is Boolean", "true", String.valueOf(owner.getVip()));

        System.out.println("POJO (Lombok @Data) compile+use check: PASS");
    }

    private static void check(String label, String expected, String actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError(label + ": expected <" + expected + "> but was <" + actual + ">");
        }
        System.out.println("  ok  " + label + " = " + actual);
    }
}
