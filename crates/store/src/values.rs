use rusqlite::types::{Value, ValueRef};
use serde_json::{Number, Value as Json};

/// JSON -> valeur SQLite. Les booléens deviennent 0/1, les objets/tableaux du texte JSON.
pub fn json_to_sql(v: &Json) -> Value {
    match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(*b as i64),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else {
                Value::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Json::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}

pub fn sql_row_to_json(r: &rusqlite::Row, ncol: usize) -> rusqlite::Result<Vec<Json>> {
    let mut out = Vec::with_capacity(ncol);
    for i in 0..ncol {
        out.push(match r.get_ref(i)? {
            ValueRef::Null => Json::Null,
            ValueRef::Integer(i) => Json::Number(i.into()),
            ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
            ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
            ValueRef::Blob(b) => Json::String(hex::encode(b)),
        });
    }
    Ok(out)
}
