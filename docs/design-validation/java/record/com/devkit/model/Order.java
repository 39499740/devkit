package com.devkit.model;

import java.math.BigDecimal;
import java.util.List;

public record Order(
    Long id,
    String name,
    BigDecimal amount,
    List<String> tags,
    Owner owner,
    Object memo
) {
}
